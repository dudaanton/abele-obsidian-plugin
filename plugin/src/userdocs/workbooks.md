# Excel workbooks

Open an `.xlsx` or `.xlsm` attachment to view its sheets on desktop or phone. If another plugin
handles the extension, use **Open in Abele workbook viewer** in the file menu. Old binary `.xls`
files are not supported.

## Viewing sheets

The grid renders only the visible rows and columns. Sheet selection includes hidden sheets
(marked in the selector). Use **Cell / Go** to jump to an A1 address. Select a cell to see its
formula above the grid. Merged cells, column widths, the first frozen header row, bold/italic,
RGB fills and common number/date formats are displayed. Unsupported formatting keeps the raw
value; charts and drawings are preserved in the file, not rendered in the grid.

Values initially come from the workbook's saved formula caches. Missing caches show **pending**;
files marked for recalculation show a stale-value warning. Macros, external links and other
active workbook content never execute. `.xlsm` files are always read-only.

## Editing and recalculation

On desktop, select a cell and choose **Edit cell**. Pick Text, Number, Boolean, Formula or
Clear, then Save. Text input stays literal, even if it begins with `=`. Saving patches only
touched XML; unsupported workbook content stays intact. Concurrent external changes are
refused, so read/reopen before trying again. Values and formulas locally recalculate dependent
caches, including other sheets, after editing. **Recalculate** refreshes the existing workbook's
formula results. The agent can do this on a phone too. Unknown functions show **#NAME?**;
cycles use **#REF!**. Local calculation is limited to 20,000 stored cells across all sheets;
array/dynamic formulas and larger books stay pending with an explicit warning. Excel may use
different formula semantics, so saved files also request native recalculation on open. Array/data-table ranges, protected sheets and merged followers must
be edited in a spreadsheet app. A shared formula group is expanded automatically before an
edit. There are no hand-editing controls on phones.

Ask an agent to read/search the workbook or write values/formulas on desktop or phone. The
agent reads a revision first; writes default to a preview and confirmation, with their own
Off/Ask/On setting. `.xlsm` remains read-only for both hand and agent editing.

## Limits

Limits: 32 MB compressed, 96 MB expanded, 8 MB per XML part, 256 sheets, 200,000 stored cells
per sheet. Only one sheet is indexed at a time to limit memory on phones.
