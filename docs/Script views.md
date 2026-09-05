# Script views

A script can open a tab of its own and fill it with an interface — cards, buttons, inputs,
tables, rendered markdown, its own HTML and CSS. The tab keeps working after the script has
finished: pressing a button calls the function the script attached to it, still holding
everything the script had in scope.

This is what to reach for when the answer is something to look at and press rather than read
once. A feed of notes, a deck of flashcards, a dashboard that refreshes as the vault changes.
For a result a person reads and closes, `show()` is still the shorter road.

## What one looks like

```js
// @name Flashcards
// @description Learn words from a deck folder
// @param deck string "Deck folder" = "Decks/German"

const paths = await find({ criteria: [{ type: 'path', operator: 'startsWith', value: params.deck }] })
const v = view({ title: 'Flashcards', icon: 'layers' })
v.state.index ??= 0

const card = new Markdown('')
const flip = new Button({ text: 'Flip', accent: true })
const next = new Button({ text: 'Next', icon: 'arrow-right' })

let back = false
async function draw() {
  const [front, rear] = (await read(paths[v.state.index])).split('\n---\n')
  card.text = back ? rear : front
}
flip.on('click', () => { back = !back; draw() })
next.on('click', () => { v.state.index = (v.state.index + 1) % paths.length; back = false; draw() })
v.on('key', (e) => { if (e.key === ' ') flip.click() })

v.body = [new Card({ children: [card] }), new Row([flip, next])]
await draw()
await v.open()
```

The script runs from the command palette like any other, and instead of returning a string it
leaves a tab behind.

## A feed of notes

The other shape these take is a list of notes as cards: a timeline to scroll through, a
reading queue, a shelf. `noteInfo(path)` gives a script what a card needs — the title, the
dates, the tags, the cover as a real path, the prose without frontmatter or markup — and
`Card` draws it with `cover` and `large`:

```js
const notes = await Promise.all(paths.map((p) => noteInfo(p)))
v.body = new Stack({ gap: 'large', children: notes.map((n) => new Card({
  title: n.title,
  large: true,
  cover: n.cover ?? undefined,
  subtitle: dayjs(n.created).format('D MMM YYYY'),
  badges: n.tags.map((t) => new Badge(t)),
  description: n.excerpt,
  children: [new Row([new Button({ text: 'Open', accent: true, onClick: () => open(n.path) })])],
})) })
```

Markdown rendered in a view — a `Markdown` node, or a note embedded in one — shows
`::abele-gallery::` blocks as galleries, the same as reading mode does.

## After a restart

Obsidian saves the tab with the workspace. When it opens again the tab says *Starting
Flashcards…*, then the plugin runs the script a second time — the same parameters, and the
state the view had saved, so the deck comes back at the card it was on. If the script has been
renamed or deleted, or it fails, the tab says so and offers **Run again**.

Closing the tab is the end of it: timers stop, handlers stop, and nothing is left running.

## Where the details are

The full reference — every component, every event, how CSS is scoped to the view — is in the
**Show script API reference** command, after the main API. The agent reads the same text.

## Asking for one

The agent writes these. "Make me a view that lists my open tasks and refreshes when I edit a
note" is enough of a brief; it will write the script, and it can look at what it built and fix
it before handing it over: `inspect_view` gives it the tree, and `screenshot` gives it a picture
of the part of the view that is on your screen at that moment — only that part, at your scroll
position, so what you have not brought into view stays out of the picture.
