# Workbook implementation

Stages X1–X6 extend the shared Office core under `plugin/src/ooxml/`; Word keeps compatibility
exports. The byte model has no Obsidian dependency. Storage adapters use the same serialized,
optimistic binary write boundary, including preflight validation, a final byte check immediately
before publication, read-back verification and prepared rewind retention. Agent tools use each
call's explicit scope, including the final write check; direct script calls retain the default.
XML is lexically patched by offsets, never rebuilt with a
spreadsheet import/export library. Unchanged ZIP entries retain their uncompressed bytes;
no-op saves retain the whole original archive.

The workbook reader resolves package relationships and indexes only one sheet at a time.
The Vue grid virtualizes both dimensions, mapping a canvas capped at 8 million pixels per
axis to the full logical sheet. This avoids WebView layout caps when jumping to sparse last
rows. Finger panning stays native; two-finger touch events zoom the grid locally rather than
relying on the app WebView's disabled page zoom. Sheet/cell/zoom survive reloads. Unsaved
desktop input survives external modifications until Save (optimistic conflict) or Cancel. Limits are shared archive limits plus 256 sheets,
200,000 stored cells per sheet, 10,000 merges and 1,000 cells per read/write range. Hidden
sheets are available but labelled. Only the first frozen header row is pinned. Charts,
pivots, drawings and unsupported formatting are preserved, not rendered. `.xlsm` and
macro-bearing packages are read-only; `.xls` is out of scope. Protection and array/data-table
ranges are never silently overwritten.

Shared formulas are expanded before a member or a blank inside the shared range is edited.
Relative/absolute A1 references are translated; quoted strings and sheet names are retained.
Whole-row/whole-column references are translated too. External/structured and 3D shared
references retain viewable caches but are not unshared; value edits requiring that expansion
are refused. ST_Xstring escapes preserve literal escape-looking text and carriage returns.
Dynamic cell metadata is not retained on value edits: those cells remain read-only. Calc-chain relationships,
parts and content-type overrides are invalidated together. Other graph parts remain untouched.

## Recalculation and licensing

HyperFormula **3.4.0**, pinned exactly after the dependency gate, is GPL-3.0-only. The repository
`LICENSE` and `plugin/package.json` are both GPL-3.0-only, so this dependency is compatible.

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

Trailing rows can be added at the end without shifting addresses. Deletion is restricted to
simple value-only workbooks without formulas, defined names or structural relationships;
full reference rewriting is not implemented. The shared storage adapter checks file size
before binary allocation, validates write eligibility again immediately before writing, and
uses an immutable queue key even if a file is renamed. Output uses the same size limits as
input so edited files remain reopenable.

## Verification

All fixtures are generated from anonymous XML in `plugin/tests/fixtures/xlsx/`. Unit tests
reopen saved workbooks and compare unaffected parts, while component tests cover virtualization
and the existing binary write preview. `xlsx.e2e.test.ts` covers desktop, the 390×844 phone
layout and the real phone; `xlsxEditing.e2e.test.ts` uses the live agent tools and desktop editor.
`xlsxPreservation.test.ts` checks generated charts, pivots/cache records, comments, tables,
conditional formatting, validation and extensions, including relationship targets and style
counts. `xlsxLibreOffice.test.ts` independently converts edited packages to ODS and back when
a headless executable is available (or named by `ABELE_SOFFICE`); it is explicitly skipped
when absent. The live phone tier also exercises real finger panning and pinch zoom. A lexical/parser reopen alone cannot prove the absence
of Excel's repair dialog.
