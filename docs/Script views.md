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
it before handing it over.
