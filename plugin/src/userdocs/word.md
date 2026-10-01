# Word documents

Open Word files in Abele, read their text with an agent, and keep the original document in the vault.

## Opening a document

Open a `.docx` file to see it in a Word tab, on desktop or phone. If another plugin already opens
Word files, use **Open in Abele document viewer** in the file's menu. The preview shows the document's
layout, tables and embedded pictures. It is a preview, not Word's page-layout engine.
External pictures and links do not connect to the internet. Opening changes nothing in the file.

**Text paragraphs** shows numbered text. Enter a paragraph number and choose **Go to paragraph**
to read a window. Large documents open in this paged text view instead of building a very large
preview. Packages are limited to 32 MB compressed, 96 MB unpacked and 8 MB per XML part.
Unpacked limits are checked against the bytes actually produced, not just sizes written in the file;
a damaged archive with inconsistent sizes is refused.

## Asking an agent

The agent can list open Word tabs, read numbered paragraph windows, and search document text,
including text split across formatting runs, table cells, headers, footers and notes. Give it the
file's path. The Word tools appear in the agent's tool settings with **Off**, **Ask** and **On**
choices; they can only read documents in the chat's scope. Reading does not convert or save the file. The agent can also replace or insert text after
reading the document. By default it shows the change and asks for confirmation before writing.

## Editing text

On desktop, choose **Text paragraphs**, then **Edit text** beside a paragraph. Edit the text and
choose **Save**, or **Cancel** to leave it alone. Existing table-cell text is edited the same way.
Phone tabs are read-only by hand; an agent can edit on either device.

Only touched text runs change. The document's styles, numbering, pictures and other package
parts are kept, not converted to Markdown and rebuilt. Text inside tracked revisions or field
results is read-only, as are headers, footers and notes. Unsupported structures are kept intact.
If the file changes while you are editing, saving refuses the older edit; cancel and reopen it.

## Formatting and structure on desktop

Open **Edit text** to see the plain-text field and document controls. Select words in that field
and choose **Bold**, **Italic**, **Underline** or **Strikethrough**; choosing the same active format
removes it. Without a selection the whole paragraph is used. Save unsaved text before applying
formatting or changing structure.

Choose a style already in the document (including its heading styles) and **Apply style**. Choose
**Bulleted list**, **Numbered list** or **No list**, then **Apply list**. There is no style designer.
You can add a paragraph below, split at the cursor, merge with the next paragraph, or delete one.
Merging retains the first paragraph's style. At least one paragraph stays in each container.

For links, select the words, enter the address and choose **Apply link**. Select an existing link
whole to change or remove it. HTTP, HTTPS and mail addresses are supported; the preview does not
contact those addresses automatically.

## Tables and pictures

In an existing table cell, the editor offers row and cell controls. Rows and **Grid column**
numbers start at 1; a merged cell spans several grid columns. Enter the first and last row/column
of a rectangle and choose **Merge cells**, or choose its first column and **Split cells**. All
selected text stays in the top-left cell when merging; after splitting it stays in the first cell.
You can add a blank row below or delete a row. Split a vertical merge before editing its rows.
Nested, irregular or protected tables are read-only rather than silently simplified.

For an inline picture, select its image number to replace, resize or delete it. To insert one,
choose a vault image path and its width and height in pixels. The path field suggests vault files.
PNG, JPEG, GIF and WebP files up to 10 MB are supported. The image is embedded in the Word file;
the source attachment stays in the vault. Floating pictures are kept untouched and read-only.
Original media stays inside the package even after a picture is replaced/deleted, so other parts
that reference it do not lose it.

These operations are available to agents on desktop and phone, with confirmation by default.
Hand editing remains desktop-only. There is no tracked-change/comment authoring, nested-table
editor, page/section setup or footnote editor. Unsupported content is preserved, not reconstructed.


