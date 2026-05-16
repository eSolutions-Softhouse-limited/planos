/**
 * Minimal, dependency-free markdown renderer for `prose` blocks.
 *
 * Intentionally small: headings, bold/italic/code inline, fenced + inline code,
 * unordered/ordered lists, blockquotes, paragraphs, hr, links. Not CommonMark
 * compliant — "render reasonably" per US-016. Zero runtime deps. No raw HTML
 * passthrough (inputs are escaped) so this stays XSS-safe by construction.
 */
import { type ReactNode } from 'react';
import { useTheme, type ThemeTokens } from './theme';

/** Inline: code spans, bold, italic, and links. Order matters. */
function renderInline(
  text: string,
  keyBase: string,
  theme: ThemeTokens
): ReactNode[] {
  const out: ReactNode[] = [];
  // Split on inline code first so emphasis inside code is left literal.
  const codeParts = text.split(/(`[^`]+`)/g);
  codeParts.forEach((part, ci) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      out.push(
        <code
          key={`${keyBase}-c${ci}`}
          style={{
            background: theme.codeInlineBg,
            padding: '1px 5px',
            borderRadius: 4,
            fontSize: '0.9em',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
      return;
    }
    // Links, then bold, then italic.
    const tokens = part.split(
      /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g
    );
    tokens.forEach((tok, ti) => {
      const k = `${keyBase}-${ci}-${ti}`;
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      if (link) {
        out.push(
          <a
            key={k}
            href={link[2]}
            target="_blank"
            rel="noreferrer"
            style={{ color: theme.accent, textDecoration: 'underline' }}
          >
            {link[1]}
          </a>
        );
      } else if (tok.startsWith('**') && tok.endsWith('**') && tok.length > 4) {
        out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
      } else if (
        (tok.startsWith('*') && tok.endsWith('*') && tok.length > 2) ||
        (tok.startsWith('_') && tok.endsWith('_') && tok.length > 2)
      ) {
        out.push(<em key={k}>{tok.slice(1, -1)}</em>);
      } else if (tok) {
        out.push(<span key={k}>{tok}</span>);
      }
    });
  });
  return out;
}

interface MdProps {
  source: string;
}

/** Block-level line walker producing React nodes. */
export function Markdown({ source }: MdProps): ReactNode {
  const theme = useTheme();
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const nodes: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block.
    if (/^```/.test(line.trim())) {
      const fenceLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        fenceLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      nodes.push(
        <pre
          key={key++}
          style={{
            background: theme.codeBg,
            color: theme.codeText,
            padding: '12px 14px',
            borderRadius: 6,
            overflowX: 'auto',
            fontSize: 13,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            margin: '8px 0',
          }}
        >
          <code>{fenceLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Horizontal rule.
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      nodes.push(
        <hr
          key={key++}
          style={{
            border: 0,
            borderTop: `1px solid ${theme.rule}`,
            margin: '14px 0',
          }}
        />
      );
      i++;
      continue;
    }

    // Heading.
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const sizes = [22, 19, 17, 15, 14, 13];
      nodes.push(
        <div
          key={key++}
          role="heading"
          aria-level={level}
          style={{
            fontSize: sizes[level - 1],
            fontWeight: 700,
            color: theme.text,
            margin: '14px 0 6px',
          }}
        >
          {renderInline(h[2], `h${key}`, theme)}
        </div>
      );
      i++;
      continue;
    }

    // Blockquote (consecutive `>` lines).
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      nodes.push(
        <blockquote
          key={key++}
          style={{
            borderLeft: `3px solid ${theme.borderStrong}`,
            margin: '8px 0',
            padding: '4px 12px',
            color: theme.textDetail,
          }}
        >
          {renderInline(quote.join(' '), `bq${key}`, theme)}
        </blockquote>
      );
      continue;
    }

    // Unordered list.
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      nodes.push(
        <ul key={key++} style={{ margin: '6px 0', paddingLeft: 22 }}>
          {items.map((it, idx) => (
            <li key={idx} style={{ margin: '2px 0' }}>
              {renderInline(it, `ul${key}-${idx}`, theme)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      nodes.push(
        <ol key={key++} style={{ margin: '6px 0', paddingLeft: 22 }}>
          {items.map((it, idx) => (
            <li key={idx} style={{ margin: '2px 0' }}>
              {renderInline(it, `ol${key}-${idx}`, theme)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Blank line.
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph (gather until blank / block boundary).
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i].trim()) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i].trim())
    ) {
      para.push(lines[i]);
      i++;
    }
    nodes.push(
      <p key={key++} style={{ margin: '6px 0', lineHeight: 1.6 }}>
        {renderInline(para.join(' '), `p${key}`, theme)}
      </p>
    );
  }

  return <div>{nodes}</div>;
}
