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

