# Excel workbooks

Open an `.xlsx` or `.xlsm` attachment to view its sheets on desktop or phone. If another plugin
handles the extension, use **Open in Abele workbook viewer** in the file menu. Old binary `.xls`
files are not supported.

## Viewing sheets

The grid renders only the visible rows and columns. Sheet selection includes hidden sheets
(marked in the selector). Use **Cell / Go** to jump to an A1 address. Select a cell to see its
formula above the grid. Pan with a finger and pinch to zoom the grid on a phone; the −/percent/+
controls work with a keyboard too. Zoom changes only the view, never cell formatting. Even a
million-row sparse sheet uses a bounded physical canvas and renders only visible cells. Merged cells, column widths, the first frozen header row, bold/italic,
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
edit. The editor also offers **Bold**, **Italic**, **Fill** (`#RRGGBB` or empty to clear), and an Excel
**Number format** code. Enter a cell/range and choose **Apply formatting**. Existing styles
and unselected cells are preserved. Agents can apply these same formats on a phone with the
usual preview. **Append row** adds a blank row at the end. **Delete last row** is available for simple
value-only workbooks; formulas, named ranges and structural references require a spreadsheet
app. Existing addresses never shift. To append populated rows, ask the agent to write beyond
the used range. Saving keeps the current sheet/cell/zoom. An external change does not discard
unsaved desktop input: a stale save is refused, and Cancel reloads the latest file.
There are no hand-editing controls on phones.

Ask an agent to read/search the workbook or write values/formulas on desktop or phone. The
agent reads a revision first; writes default to a preview and confirmation, with their own
Off/Ask/On setting. `.xlsm` remains read-only for both hand and agent editing.

## Limits

Limits: 32 MB compressed, 96 MB expanded, 8 MB per XML part, 256 sheets, 200,000 stored cells
per sheet. Only one sheet is indexed at a time to limit memory on phones.
