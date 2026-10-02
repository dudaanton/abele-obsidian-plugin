# Workbook implementation

Stages X1–X6 extend the shared Office core under `plugin/src/ooxml/`; Word keeps compatibility
exports. The byte model has no Obsidian dependency. Storage adapters use the same serialized,
optimistic binary write boundary. XML is lexically patched by offsets, never rebuilt with a
spreadsheet import/export library. Unchanged ZIP entries retain their uncompressed bytes;
no-op saves retain the whole original archive.

The workbook reader resolves package relationships and indexes only one sheet at a time.
The Vue grid virtualizes both dimensions. Limits are shared archive limits plus 256 sheets,
200,000 stored cells per sheet, 10,000 merges and 1,000 cells per read/write range. Hidden
sheets are available but labelled. Only the first frozen header row is pinned. Charts,
pivots, drawings and unsupported formatting are preserved, not rendered. `.xlsm` and
macro-bearing packages are read-only; `.xls` is out of scope. Protection and array/data-table
ranges are never silently overwritten.

Shared formulas are expanded before a member or a blank inside the shared range is edited.
Relative/absolute A1 references are translated; quoted strings and sheet names are retained.
External/structured and 3D shared references are not translated. Calc-chain relationships,
parts and content-type overrides are invalidated together. Other graph parts remain untouched.

## Recalculation and licensing

HyperFormula **3.4.0**, pinned exactly after the dependency gate, is GPL-3.0-only. The repository
`LICENSE` is GPL-3.0 and the research explicitly approved this compatible combination.
`plugin/package.json` still has historical MIT metadata; that inconsistency should be resolved
by the maintainer before distributing a differently licensed artifact.

The MIT alternative `@formulajs/formulajs` supplies formula functions, not a workbook parser,
reference translator and dependency graph. The existing arithmetic `fparser` dependency is
also not a spreadsheet engine. HyperFormula supplies the headless dependency graph without
bringing another grid or reconstructing the archive. No server or external fetch is involved.

Evaluation uses sparse address mapping, a 20,000-stored-cell workbook cap, cooperative yields
while feeding cells and a fresh engine destroyed after every operation. Literal strings never
become formulas implicitly in the engine. Defined names and the 1900/1904 date systems are
fed explicitly. Unsupported functions show `#NAME?`; cycles/other engine-only errors are
stored using Excel-compatible errors. Array/data-table/dynamic formula metadata is left
pending rather than fabricating dependent results. Formula caches, not formulas, are patched
across sheets. A saved workbook requests native recalculation too: this is not full Excel
semantic equivalence.

## Verification

All fixtures are generated from anonymous XML in `plugin/tests/fixtures/xlsx/`. Unit tests
reopen saved workbooks and compare unaffected parts, while component tests cover virtualization
and the existing binary write preview. `xlsx.e2e.test.ts` covers desktop, the 390×844 phone
layout and the real phone; `xlsxEditing.e2e.test.ts` uses the live agent tools and desktop editor.
Independent spreadsheet-app reopen checks belong in the round-trip tier when a headless
LibreOffice executable is available. A lexical/parser reopen alone cannot prove the absence
of Excel's repair dialog.
