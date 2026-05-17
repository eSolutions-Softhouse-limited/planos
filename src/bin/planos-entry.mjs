// planos CLI dispatcher — SOURCE entry for the bundled `plugin/bin/planos`.
//
// This file is the esbuild entry point (`npm run build:bin` →
// esbuild.bin.mjs → plugin/bin/planos). It uses STATIC imports so the whole
// blocking handler set is inlined into one self-contained, zero-dependency
// file that ships inside `./plugin` (the marketplace package boundary). The
// previous `plugin/bin/planos` used `import(resolve(__dirname,'../../src/…'))`
// which escaped the package boundary — `src/` is never packaged, so an
// installed copy could not import any handler. Bundling fixes that.
//
// M1 (ADR-0007): planos is a SINGLE flow — PRD. The `enter`, `exit` and
// `review` subcommands (ExitPlanMode/EnterPlanMode roundtrip + diff-review)
// were removed. Only `prd` (the blocking PRD round-trip) and `export` (the
// out-of-blocking-path markdown export) remain.
//
// AC-17: this entry + its static closure are audited by the import-graph
// walk over the SOURCE roots (tests/harness/import-graph.mjs ac17Roots());
// the committed `plugin/bin/planos` is proven byte-identical to a fresh
// build of exactly these sources by tests/bin-bundle.test.mjs (the
// AC-P17-style drift gate). Zero runtime deps; node: builtins only.

import { handlePrd } from '../hook/prd.mjs';
import { handleExport } from '../hook/export.mjs';

const subcommand = process.argv[2];

if (!subcommand) {
  process.stderr.write(
    'Usage: planos <subcommand>\nSubcommands: prd, export\n',
  );
  process.exit(1);
}

switch (subcommand) {
  case 'prd': {
    await handlePrd();
    break;
  }
  case 'export': {
    await handleExport();
    break;
  }
  default: {
    process.stdout.write('[planos unknown command: ' + subcommand + ' stub]\n');
    process.exit(0);
  }
}
