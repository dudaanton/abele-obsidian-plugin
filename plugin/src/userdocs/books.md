# Books

A reader for the books in your vault, with highlights kept as a note and an AI agent that can
read along.

## Opening a book

EPUB, Kindle (`.mobi`, `.azw`, `.azw3`), FictionBook (`.fb2`, `.fbz`) and comic archives (`.cbz`)
open in the reader when you click them in the file explorer, and so do PDFs. To read PDFs in
Obsidian's own viewer instead, turn off **Open PDF files in the Abele reader** in
**Settings → Abele → Books**; **Open in Abele reader** in a PDF's menu then still opens one here.

The reader never changes a book file.

## Reading

Turn pages with the arrow keys, the space bar, a tap near the edge or a swipe. The tab's menu
switches between pages and scrolling. The list button in the tab's header opens the contents, and
the search button searches the whole book. A tap on a note mark opens the note over the page. A
tap on a picture or a table opens it full screen.

The line under the page shows the chapter and how far you are. Tap it to switch between pages
in the chapter, pages left, location and percentage.

## Bookmarks

The bookmark at the end of the line under the page marks the page on screen; tap it again to
remove it. The **Bookmarks** tab beside the contents lists them in the book's order, with the
chapter and the page's first words. A bookmark stays with the words at the top of its page when
the text size changes, and reaches your other devices like your place does.

## Your place, on every device

The reader remembers where you stopped in each book, and keeps it in a file in the vault
(`abele-book-places.json` unless changed), so the place follows you to every synced device. Moving
or renaming a book keeps its place. With Obsidian Sync, turn on **Sync all other types** so this
file travels; chats need the same switch.

## Highlights

Select words, with the mouse or a long press, and a bar appears: a colour highlights them, the
speech bubble adds a comment, the link copies a link to the words, and the quote puts them into
the note you last worked in. Tap a highlight to change or remove it.

Highlights are kept in a note, `<book name> highlights.md` beside the book by default, one
callout per highlight with a link back to its place. Edit that note freely: the open book redraws
as it changes. In **Settings → Abele → Books** you can send highlights to one shared note instead,
choose per book, and give the note a template.

A link to a place in a book opens the book there, just like a link to a heading opens a note.

## Asking about a passage

With the AI agent on, **Ask here** on selected words starts a discussion about them. It is kept in
the highlights note beside the passage, and the words stay marked. Agents can also read, search
and open your books on their own, within their scope. See [Comments](comments).

## Reading aloud

The speaker button reads the book aloud from the page on screen, with your device's voices,
turning pages as it goes. **Read aloud from here** on selected words starts there. Choose the
voice and speed in the reader's settings.

## Text and layout

The **Aa** button changes the font, text size, line spacing, margins, column width, two columns
and whether the book takes the theme's colours. The
same settings are in **Settings → Abele → Books**, and they travel with a settings transfer.
