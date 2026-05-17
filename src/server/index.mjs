/**
 * planos blocking HTTP server — Node 20+, node:http only, zero runtime deps.
 *
 * Lifecycle (AC-3, Step 0.2):
 *   startServer({ onReady, serveHtml }) → { decisionPromise, server, finish }
 *
 *   finish(decision):
 *     1. JSON.stringify(decision) → process.stdout (write + drain)
 *     2. server.close()
 *     3. process.exit(0)
 *
 *   Ordering invariant: process exits 0 ONLY after stdout is fully flushed.
 *   The small delay inside flushStdout() is an implementation aid to allow the
 *   OS pipe to drain — it is NOT the contract. The contract is flush-then-exit.
 */

import { createServer } from 'node:http';

const MAX_PORT_RETRIES = 20;

/**
 * Attempt to bind a server to a random ephemeral port.
 * On EADDRINUSE, retries up to MAX_PORT_RETRIES times on new ports.
 *
 * @param {import('node:http').Server} server
 * @returns {Promise<number>} the port actually bound
 */
function bindFreePort(server) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    function tryBind() {
      attempts += 1;

      const onError = (err) => {
        if (err.code === 'EADDRINUSE' && attempts < MAX_PORT_RETRIES) {
          // Remove the error listener added by the previous attempt before retrying
          server.removeAllListeners('error');
          tryBind();
        } else {
          reject(err);
        }
      };

      // Port 0 → OS picks a free ephemeral port
      server.listen(0, '127.0.0.1', () => {
        // LOW-a: the bind succeeded — drop the per-attempt error listener so it
        // does not leak for the server's whole lifetime (only the EADDRINUSE
        // retry path used to remove it; the success path never did).
        server.removeListener('error', onError);
        const { port } = server.address();
        resolve(port);
      });

      server.once('error', onError);
    }

    tryBind();
  });
}

/**
 * Read the full request body as a string.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Send a response and resolve only after the OS has accepted the entire body
 * AND the socket has been flushed (the `res.end` callback + `finish` event).
 *
 * M2 Defect 2: the decision promise must NOT resolve (→ finish() → flush
 * stdout → process.exit(0)) until the browser's POST has been fully read AND
 * our `{ ok: true }` 200 has been written back. Previously `resolveDecision`
 * ran immediately after `res.end()` was *called* (not flushed), so a fast
 * `finish()`/`process.exit(0)` could race the socket flush — the browser saw a
 * dropped connection while the UI had already flipped to "captured". Awaiting
 * the `finish` event closes that window.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {Record<string, string>} headers
 * @param {string} body
 * @returns {Promise<void>}
 */
function sendAndFlush(res, status, headers, body) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    res.writeHead(status, headers);
    // `finish` fires once the last chunk has been handed to the OS for the
    // underlying socket; the end() callback is belt-and-suspenders.
    res.once('finish', done);
    res.end(body, done);
  });
}

/**
 * Write data to process.stdout and wait for the OS buffer to drain.
 *
 * Node's process.stdout.write() is synchronous for TTYs but buffered for
 * pipes (the common case in a hook: stdout is a pipe read by Claude Code).
 * We use the write() callback (fires when the kernel has accepted the data)
 * and then wait one tick for the pipe reader to consume it.  This is an
 * implementation detail — the observable contract is that the write is
 * complete before we proceed to server.close() / process.exit(0).
 *
 * @param {string} text
 * @returns {Promise<void>}
 */
function flushStdout(text) {
  return new Promise((resolve, reject) => {
    const flushed = process.stdout.write(text, 'utf8', (err) => {
      if (err) { reject(err); return; }
      // The write callback fires when Node has handed the data to the OS.
      // For a pipe, give the reader one event-loop tick to consume it,
      // then resolve. This is an implementation aid for flush, not the
      // contract — the contract is ordering (flush → close → exit), not ms.
      setImmediate(resolve);
    });

    // If write() returned true the buffer was drained synchronously (TTY or
    // small payload); callback still fires but we don't need drain in that case.
    if (flushed) {
      // callback will still fire; nothing extra needed
    }
  });
}

/**
 * Start the planos blocking HTTP server.
 *
 * @param {object} [options]
 * @param {(url: string) => void} [options.onReady]   Called after server is listening. Default: no-op.
 * @param {string}               [options.serveHtml]  HTML blob served at GET /. Default: empty page.
 * @param {Record<string, (req: import('node:http').IncomingMessage)
 *           => { status?: number, json?: unknown, body?: string, contentType?: string }>}
 *   [options.apiHandlers]
 *   Optional map of `"<METHOD> <pathname>"` → synchronous read-only handler.
 *   Used by the real-SPA path (US-014) to expose `GET /api/plan`,
 *   `GET /api/plan/versions`, `GET /api/plan/version` WITHOUT growing the
 *   server's hard-coded route table. Handlers are read-only (no decision
 *   resolution) and pure (no network, no model). The query string is part of
 *   the lookup key's pathname only — handlers read `req.url` for params.
 * @returns {Promise<{
 *   decisionPromise: Promise<object>,
 *   server: import('node:http').Server,
 *   finish: (decision: object) => Promise<void>
 * }>}
 */
export async function startServer({
  onReady = () => {},
  serveHtml = '<html><body></body></html>',
  apiHandlers = {},
} = {}) {
  let resolveDecision;

  /** Resolves when the user POSTs approve or deny. */
  const decisionPromise = new Promise((res) => {
    resolveDecision = res;
  });

  const server = createServer(async (req, res) => {
    const { method, url } = req;

    // --- GET / → serve the SPA HTML blob ---
    if (method === 'GET' && url === '/') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(serveHtml),
      });
      res.end(serveHtml);
      return;
    }

    // --- POST /api/approve ---
    if (method === 'POST' && url === '/api/approve') {
      try {
        // M2 Defect 2: fully read the body, THEN write+flush the 200, THEN
        // resolve the decision. resolveDecision triggers finish() → flush
        // stdout → process.exit(0); doing it only after the response socket
        // has flushed guarantees the browser's POST is never raced by exit.
        const body = await readBody(req);
        const payload = body ? JSON.parse(body) : {};
        const decision = { behavior: 'allow', ...payload };
        await sendAndFlush(
          res,
          200,
          { 'Content-Type': 'application/json' },
          JSON.stringify({ ok: true }),
        );
        resolveDecision(decision);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    // --- POST /api/deny ---
    if (method === 'POST' && url === '/api/deny') {
      try {
        // M2 Defect 2: read body → flush 200 → resolve (see /api/approve).
        const body = await readBody(req);
        const payload = body ? JSON.parse(body) : {};
        const decision = { behavior: 'deny', ...payload };
        await sendAndFlush(
          res,
          200,
          { 'Content-Type': 'application/json' },
          JSON.stringify({ ok: true }),
        );
        resolveDecision(decision);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    // --- Injected read-only API handlers (US-014: /api/plan*) ---
    // Looked up by "<METHOD> <pathname>" (query string stripped); the handler
    // itself reads req.url for params. Read-only: handlers NEVER resolve the
    // decision promise (only /api/approve|deny do) and are pure (no egress).
    {
      const pathname = (url || '').split('?')[0];
      const handler = apiHandlers[`${method} ${pathname}`];
      if (typeof handler === 'function') {
        try {
          const out = handler(req) || {};
          const status = typeof out.status === 'number' ? out.status : 200;
          if (out.json !== undefined) {
            const payload = JSON.stringify(out.json);
            res.writeHead(status, {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
            });
            res.end(payload);
          } else {
            const text = typeof out.body === 'string' ? out.body : '';
            res.writeHead(status, {
              'Content-Type': out.contentType || 'text/plain; charset=utf-8',
              'Content-Length': Buffer.byteLength(text),
            });
            res.end(text);
          }
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
        return;
      }
    }

    // --- 404 for everything else ---
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  // Bind to a free port (retries on EADDRINUSE)
  const port = await bindFreePort(server);
  const url = `http://127.0.0.1:${port}`;

  // Call the injectable seam — real impl opens a browser; tests pass a mock
  onReady(url);

  /**
   * finish(decision) — the lifecycle closer.
   *
   * Ordering invariant (AC-3):
   *   1. Write decision JSON to stdout and await full flush.
   *   2. Close the HTTP server (stops accepting new connections).
   *   3. Exit 0.
   *
   * Process exits 0 ONLY after stdout is observably flushed.
   *
   * @param {object} decision
   * @returns {Promise<void>}
   */
  async function finish(decision) {
    await flushStdout(JSON.stringify(decision));
    server.close();
    process.exit(0);
  }

  return { decisionPromise, server, finish };
}
