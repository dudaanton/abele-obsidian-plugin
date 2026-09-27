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

Turn pages with the arrow keys, Page Up and Page Down, the space bar, a tap near the edge or a swipe. The tab's menu
switches between pages and scrolling. The list button in the tab's header opens the contents, and
the search button searches the whole book. A tap on a note mark opens the note over the page. A
tap on a picture or a table opens it full screen.

A PDF zooms with a pinch — two fingers on a touch screen, also while drawing, or Ctrl with the
mouse wheel — or with the zoom buttons under the page, which also fit the page or its width. Each
PDF keeps its zoom on the device it was set on.

While drawing on a PDF, the squiggle beside the colours under the page sets how thick the pen and
the marker draw: fine, medium or bold. The choice is kept for every PDF, and is also under **Pen
thickness** in **Settings → Abele → Books**.

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
callout per highlight with a link back to its place. The note's `file` property links back to
the book and shows as a card with its cover. Edit that note freely: the open book redraws
as it changes. In **Settings → Abele → Books** you can send highlights to one shared note instead,
choose per book, and give the note a template.

A link to a place in a book opens the book there, just like a link to a heading opens a note.
And it works the other way too: words that any of your notes link to get a dotted underline in
the book. Tap them to open the note; when several notes link there, pick one from a menu.

## Running a script on words

With [scripts](scripts) turned on, the bar on selected words (and on a highlight) offers the
scripts of your **book menu**, so the ones you use most are a single tap. Up to three are a button
each, with their icons; with more, one button opens a menu of them. The last button (or the last
line of that menu, **Other script…**) lists all your scripts to pick any other.

The book menu is set up in **Settings → Books → Scripts on selected words**: add a script
from a search, give it a shorter name or another icon, move it up or down, take it off. Or set it
up in place: in the list of all scripts each has a pin at the end of its row, and tapping the pin
puts the script on the menu (or takes it off) without running it. A script whose header has the
line `// @book` is on the menu too, after the ones you chose; add it to the list to give it a
place of its own.

The script is given the words, the whole sentence they are in, a link to this place, the book and
the chapter, as `book`; a parameter marked `selection` is filled with the words.

For example, this script translates a word with the AI agent and makes a card for learning it,
with the sentence and a link back to the page. The card links to the book, so the word is marked
there, and tapping it opens the card.

```js
// @name Word card
// @description Translate the word and make a card
// @icon languages
// @book
// @param word string "Word" selection
// @param into string "Translate into" = "English"

if (!book) return 'Select a word in a book and run this from the bar'
const translation = (await agent(
  `Translate "${params.word}" into ${params.into} as it is used in this sentence. ` +
  `Answer with the translation only.\n\n${book.sentence}`
)).trim()
const name = params.word.replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim()
const path = `Cards/${name}.md`
const card = [
  '---',
  'type: card',
  `translation: "${translation.replace(/"/g, "'")}"`,
  '---',
  '',
  `**${params.word}** — ${translation}`,
  '',
  `> ${book.sentence}`,
  `> — ${book.link}`,
  '',
].join('\n')
// A word met again gets the new sentence added to its card.
const old = await read(path).catch(() => null)
if (old === null) await create(path, card)
else await write(path, `${old}\n> ${book.sentence}\n> — ${book.link}\n`)
return `${params.word}: ${translation}`
```

Without the AI agent, `fetch` can ask a translation service instead.

## Asking about a passage

With the AI agent on, **Ask here** on selected words starts a discussion about them. It is kept in
the highlights note beside the passage, and the words stay marked. See [Comments](comments).

## Letting the agent work with a book

In a chat the agent can find your books, open one at a place, read its contents, search it —
the whole book or only the chapters you name — and read the passages it finds. It can also mark
the book for you: highlight words in any colour with a note on them, change or remove a
highlight, and add or remove bookmarks. Its highlights go to the same note as yours and look the
same in the book. It reads on its own, but asks before it marks anything, the way it asks before
editing a note; you can change that for each agent in its tools. It reaches only the books in the
chat's scope.

Try asking: "find where the book talks about memory in chapters 3 to 5 and highlight the key
sentence in green, with a note on why it matters". Highlights work in EPUB and other e-books
and in PDFs that have text; a scanned PDF has no words to highlight.

## E-ink readers

On a reader with an e-ink screen, such as a Boox, turn on **E-ink mode** under **E-ink, on this
device** in the **Aa** settings, or run **Toggle e-ink mode for books on this device** from the
command palette, or pick it in the tab's menu. It is kept on that device only: your phone and
computer read as before, and a settings transfer does not carry it.

In e-ink mode:

- Pages are turned, never scrolled or slid, a PDF's too; a swipe turns the page once, when your
  finger lifts, instead of dragging it.
- Text is black on white whatever the theme, nothing is grey, and lines are thicker. Nothing
  moves, fades or casts a shadow.
- Highlights are lines instead of colour, and the shape tells the colour: yellow underlined,
  green underlined twice, blue a dashed underline, pink boxed, purple a dashed box, orange lined
  above and below. The bar over selected words shows each colour as its shape.
- A tap in the left or right third of the page turns it.
- **Full refresh** flashes the page black and then white every 5, 10, 20 or 50 pages, which
  clears the ghost of earlier pages the screen leaves.

The page buttons turn the pages when they send Page Up and Page Down, the arrow keys or the volume
keys. On a Boox, set the buttons for Obsidian in its **App Optimization → Customize Buttons**
(the names vary by model): try **Page-turning** first, then **Volume**. If the pages still do not
turn, switch on **Show the keys the reader hears** in the same settings: the last key the reader
heard shows over the page. Nothing showing when you press a button means the button never
reaches Obsidian.

## Zen mode

**Zen mode** leaves only the book's text on screen: the tab's header, the row under the page and,
on a phone, Obsidian's own bars go, and the page takes their room. Turn it on from the tab's menu
(**Zen mode**) or with **Toggle zen mode for books on this device**, which you can give a hotkey.

- On a phone or a tablet, tap the middle of the page to bring the header and the row under the
  page back for a few seconds; tap again to hide them sooner.
- On a computer, move the mouse to the top of the tab to bring the header back.
- Selecting words still brings up their bar, over the bottom of the page.
- Leave it from the tab's menu (**Leave zen mode**), the command, or with Esc on a keyboard.

Like e-ink mode it is kept on the device where you turned it on, and a settings transfer does not
carry it.

## Reading aloud

The speaker button reads the book aloud from the page on screen, with your device's voices,
turning pages as it goes. **Read aloud from here** on selected words starts there. Choose the
voice and speed in the reader's settings.

## Text and layout

The **Aa** button changes the font, text size, line spacing, margins, column width, two columns
and whether the book takes the theme's colours. The
same settings are in **Settings → Abele → Books**, and they travel with a settings transfer.

### Your own fonts

Put font files — `.ttf`, `.otf`, `.woff` or `.woff2` — in the **Fonts** folder at the root of
the vault, or in the folder named under **Fonts folder** in the same settings. Every family in it
appears in the **Font** list after the book's own: the regular, bold and italic files of one
family become one entry, named as the font names itself. Files added, renamed or removed show up
at once, in a book that is open too.

The files live in the vault, so they reach your phone and tablet the way your notes do. With
Obsidian Sync, turn on **Sync all other types** in its settings, or font files are left behind. On
a device the files have not reached yet the book is set in a serif, and the list says the font is
not in the folder.
