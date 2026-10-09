# Live design measurements

Screenshots show a state; geometry makes its layout contract executable. The portable tooling
lives under `plugin/tests/helpers/design{Capture,Lint,Annotate}.ts`. The live adapter is
`plugin/tests/e2e/helpers/designLint.ts`. It uses the existing selected-vault CLI transport;
it does not open another vault or install a build. Deployment and device drivers remain local.

## Run

A local `design-lint <selector> <out-dir> [config.json] [--json]` entry point can call
`measureDesign(selector, outDir, config.capture, config.rules)`. Select the running test
vault through `OBSIDIAN_TEST_VAULT`. Lease that environment before driving it. The default
CLI output should be a short PASS/FAIL summary; JSON is available explicitly. Exit 1 means
measured violations; exit 2 means a transport/usage failure. Integrate the call immediately after opening
each desktop/mobile design state, before closing it.

The adapter writes:

- `capture.png`: unmodified window capture;
- `report.json`: geometry, native measurements, current artifact names and violations with CSS-pixel boxes/deltas;
- `annotated.png`: element boxes (blue), text-column guides (blue dashed), font-metric
  baseline guides (green), violation boxes and numbered labels (red);
- `violation-NNN-<rule>-3x.png`: a three-times crop for every violation, numbered as in JSON.
  Each crop highlights only its own violation so neighbouring labels do not obscure the defect.

On reuse, only crops listed in a previous tool-owned manifest are removed. Other output-directory
files are never swept; read the current `artifacts` list rather than treating old unlisted files
as evidence for this pass.

Always inspect the normal capture, annotation and relevant crops together. A successful
measurement does not establish that a design is good; these are specific structural checks,
not a substitute for visual review. The screenshot includes only the current viewport;
scroll and measure again to cover a long container. Visible fragments retain their full DOM
rects. Baselines are derived from Range bounds and canvas font descent, not an exposed browser
baseline API. Coordinates use CSS pixels, independent of screenshot device scale.

## Declaring the contract

Common kit and native tree/file/search rows have built-in selectors. For other containers,
use selectors in a config or attributes in test markup:

```json
{
  "capture": {
    "rowSelector": "[data-design-row]",
    "kindAttribute": "data-design-kind",
    "levels": {
      "section": "[data-design-level=section]",
      "title": "[data-design-level=title]",
      "meta": "[data-design-level=meta]",
      "detail": "[data-design-level=detail]"
    },
    "iconSelector": "svg",
    "actionSelector": "[data-design-action]",
    "nativeSelector": ".backlink-pane .tree-item-self"
  },
  "rules": { "tolerance": 1, "touchSize": 44, "requireNative": true }
}
```

Every viewport-visible element is captured, including wrappers. Text roles use actual text
nodes, not a wrapper's aggregate `textContent`. Declared text blocks additionally gather all
of their visible descendant Range rects, excluding SVG/disclosure glyphs. Alignment uses the
first text line, not the centre of a multiline block or its padded control. A trailing SVG
inside an action wrapper belongs to the title line; a disclosure's own SVG does not.

Rules report:

- `line-alignment`, `text-left-edge`, `row-column`: leading/trailing icon centres and text
  columns; cross-row columns compare rows of one declared kind;
- `spacing-scale`, `row-spacing`: actual computed theme `--size-2-*`/`--size-4-*` tokens,
  padding/margins/CSS gaps, adjacent vertical and flex/grid horizontal siblings, icon-to-text
  and semantic text gaps; computed `auto` margins/distributed free space are not design gaps,
  and a negative margin can use the signed magnitude of a theme token;
- `hierarchy-consistency`, `hierarchy-order`, `hierarchy-emphasis`: level typography and
  child emphasis. Colour order uses contrast against the inherited background so dark
  themes work too. A detail identical to the title is reported even when not heavier;
- `clipping`, `sibling-overlap`, `text-triangle`, `touch-target`: overflowing clipped content,
  intersecting CSS-layout siblings, text disclosure triangles, enabled mobile controls below 44px.
  SVG paint primitives remain captured but are not CSS-layout siblings. Intentional scrolling
  and visible overflow are not clipping;
- `native-parity`: measured deltas for icon size, row padding, icon/text gap and line height
  against a visible native reference in the same renderer. Backlinks is preferred when available;
  native row kinds use their corresponding reference metrics instead of comparing an indented
  search result with a section heading. `native-reference-missing` prevents
  a pass without a reference when required. Reference metrics absent in a native row (e.g. no
  icon) are retained as absent, never invented.

Geometry tolerance defaults to 1 CSS px. Font-size and weight tolerances are configurable
separately (`fontTolerance`, `weightTolerance`); contrast uses `contrastTolerance` (0.1 by
default). An absent selector fails rather than producing a vacuous pass. Unclassified text
still participates in clipping/glyph/overlap checks, but a semantic hierarchy cannot be
inferred reliably: declare the levels and row kinds for custom layouts.

## Tests

```sh
cd plugin
npx vitest run tests/harness/designLint.test.ts tests/harness/designCapture.test.ts tests/harness/designAnnotate.test.ts tests/harness/designReport.test.ts --maxWorkers=2
OBSIDIAN_TEST_VAULT=sample-test-vault npm run test:e2e -- tests/e2e/designLint.e2e.test.ts --maxWorkers=2
```

The live contract requires a development build exposing `openDesignCatalogue`. It deliberately
fails when that API is absent or the current catalogue violates the rules; there is no skip
or screenshot-only baseline that silently blesses defects. Set `DESIGN_LINT_OUT_DIR` to retain
the evidence in a design pass. The DOM-only unit tests test the collector contract, not browser
layout; real Range geometry and screenshots require the live adapter.
