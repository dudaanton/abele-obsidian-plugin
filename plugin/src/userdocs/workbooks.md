---
title: Excel workbooks
---

Open an `.xlsx` or `.xlsm` attachment to view its sheets on desktop or phone. If another plugin
handles the extension, use **Open in Abele workbook viewer** in the file menu. Old binary `.xls`
files are not supported.

The grid renders only the visible rows and columns. Sheet selection includes hidden sheets
(marked in the selector). Use **Cell / Go** to jump to an A1 address. Select a cell to see its
formula above the grid. Merged cells, column widths, the first frozen header row, bold/italic,
RGB fills and common number/date formats are displayed. Unsupported formatting keeps the raw
value; charts and drawings are preserved in the file, not rendered in the grid.

Values initially come from the workbook's saved formula caches. Missing caches show **pending**;
files marked for recalculation show a stale-value warning. Macros, external links and other
active workbook content never execute. `.xlsm` files are always read-only.

Limits: 32 MB compressed, 96 MB expanded, 8 MB per XML part, 256 sheets, 200,000 stored cells
per sheet. Only one sheet is indexed at a time to limit memory on phones.
