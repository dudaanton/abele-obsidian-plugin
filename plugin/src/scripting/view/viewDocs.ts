/**
 * What a script builds a view out of, written once for both readers.
 *
 * The main reference (`apiDocs.ts`) says what a script can call; this says what it can put on
 * screen. The agent asks for it through `script_api_docs` with `section: 'views'`; a person
 * gets it under the "Show script API reference" command, after the main text. Same string
 * either way, and `tests/unit/scriptApiDocs.test.ts` checks that every class the prelude hands
 * a script is named here — the catalogue and its reference cannot drift apart quietly.
 */
export const SCRIPT_VIEW_DOCS = `# Script Views

A script can open a tab of its own and fill it with components. Build instances, attach
handlers, hand them to a \`View\`, and \`await v.open()\`. The script then ends; the tab, its
handlers and its state live until it is closed, and come back after Obsidian restarts.

\`view\` and every class below are globals inside a script — nothing is imported. One \`view()\`
per run is the supported shape: it is the one a restored tab rebuilds.

Use a view for anything a person will look at and press. \`show()\` is for a result read once.

---

## A first view

Language flashcards, with keyboard shortcuts and a position that survives a restart:

\`\`\`js
// @name Flashcards
// @description Learn words from a deck folder
// @icon layers
// @param deck string "Deck folder" = "Decks/German"

const paths = await find({ criteria: [{ type: 'path', operator: 'startsWith', value: params.deck }] })
const v = view({ title: 'Flashcards · ' + params.deck, icon: 'layers' })
v.state.index ??= 0

const card = new Markdown('')
const progress = new Badge('')
const flip = new Button({ text: 'Flip', accent: true })
const next = new Button({ text: 'Next', icon: 'arrow-right' })

let back = false
async function draw() {
  const [front, rear] = (await read(paths[v.state.index])).split('\\n---\\n')
  card.text = back ? rear : front
  progress.text = \`\${v.state.index + 1} / \${paths.length}\`
}
flip.on('click', () => { back = !back; draw() })
next.on('click', () => { v.state.index = (v.state.index + 1) % paths.length; back = false; draw() })
v.on('key', (e) => { if (e.key === ' ') flip.click(); if (e.key === 'ArrowRight') next.click() })

v.body = [new Row([progress]), new Card({ children: [card] }), new Row([flip, next])]
await draw()
await v.open()
\`\`\`

Nothing is rendered until \`open()\`. After it, the run ends and the closure above — \`paths\`,
\`back\`, \`draw\` — stays alive for as long as the tab does.

---

## The View

\`view({ title, icon? })\` creates one. \`icon\` is a Lucide name and defaults to \`scroll-text\`.

| Member | Meaning |
|---|---|
| \`title\`, \`icon\` | Tab title and icon. Reactive: assign and the tab changes. |
| \`body\` | A node or an array of nodes. Reactive. |
| \`state\` | A plain object, saved with the tab and filled in before the script runs when the tab is being restored. Must be JSON. |
| \`style(css)\` | Adds CSS that applies inside this view only. May be called more than once. |
| \`on(event, fn)\` | \`close\`, \`focus\`, \`blur\`, \`key\`, \`vault\`, \`resize\`. Returns the view. |
| \`every(ms, fn)\` | \`setInterval\` that is cleared when the view closes. Returns a stop function. |
| \`open({ where?, active? })\` | Opens the tab. \`where\`: \`tab\` (default), \`split\`, \`sidebar\` (right), \`window\`. Resolves once mounted. A second call throws. |
| \`close()\` | Closes the tab. |
| \`find(id)\` | The node with that \`id\`, anywhere in the tree. |
| \`signal\` | An \`AbortSignal\` aborted when the tab closes. Long loops in handlers check it. |
| \`isOpen\` | Boolean. |
| \`errors\` | The messages in the strip at the top: the last 20, with a repeat of the message already there folded away. |

Events:

- \`v.on('key', fn)\` — the native \`KeyboardEvent\`. Fires only while this view's leaf is active
  and focus is not in an input, textarea, select or editable element. The handler calls
  \`preventDefault()\` itself if it wants to.
- \`v.on('vault', fn)\` — \`{ type: 'create' \\| 'modify' \\| 'delete' \\| 'rename', path, oldPath? }\`
  for every change in the vault. This is how a dashboard refreshes.
- \`v.on('resize', fn)\` — \`{ width, height }\` of the view's own element. A script that wants a
  narrow layout reads this, never \`window.innerWidth\`.
- \`v.on('focus', fn)\`, \`v.on('blur', fn)\` — the tab became the active one, or stopped being it.
- \`v.on('close', fn)\` — fires once. After it, \`state\` is no longer saved, timers are cleared,
  \`v.signal\` is aborted and no handler is called again.

After Obsidian restarts, the tab comes back by itself. It shows \`Starting <script name>…\`, then the
plugin runs the same script again with the same \`params\` and \`v.state\` already filled in, and
\`open()\` binds to the waiting tab instead of making a new one. Write the script so that a run
with a state it did not set up still makes sense. If the script is gone, throws, finishes
without opening a view, or scripts are turned off, the tab says so and offers **Run again**.

---

## Nodes

Every class below extends one base. The base gives:

| Member | Meaning |
|---|---|
| \`id?\` | Optional. Shown by \`inspect_view\`; \`v.find(id)\` returns the node. |
| \`hidden\` | Boolean. A hidden node is not rendered. |
| \`cls?\` | Extra class on the root element, for \`v.style()\` to target. |
| \`children\` | Array of nodes, for containers. Reactive; push and splice work. |
| \`add(...nodes)\`, \`remove(node)\`, \`clear()\` | Convenience over \`children\`. |
| \`update(patch)\` | Assigns several props at once. |
| \`on(event, fn)\` | Adds a handler. Returns the node. |
| \`emit(event, payload)\` | Calls them. \`button.click()\` is \`emit('click')\`. |

Every instance is a reactive proxy: assign a prop and that part of the screen re-renders.
There is no \`render()\` to call.

\`onClick\` in the constructor and \`.on('click', fn)\` mean the same thing, with one difference:
\`update({ onClick: fn })\` **replaces** the handlers for that event, the way an assignment does,
while \`.on('click', fn)\` adds one alongside the others. Patching in a loop with \`update\` leaves
one handler, not one per pass.

### Layout

| Class | Props |
|---|---|
| \`Stack(children \\| { children, gap? })\` | \`gap\`: \`none\` \`small\` \`medium\` (default) \`large\`. A column. |
| \`Row(children \\| { children, gap?, justify?, wrap? })\` | \`justify\`: where the children sit along the row — \`start\` (default) \`center\` \`end\` \`between\`. Items are already centred vertically; \`justify: 'center'\` puts a toolbar in the middle of the screen, which is rarely wanted. \`wrap\` default true. |
| \`Grid(children \\| { children, wide?, stack? })\` | Cards in a responsive grid. \`wide\` for fewer, wider columns; \`stack\` for one column. |
| \`Section({ title?, desc?, children })\` | A titled block. |
| \`Tabs({ tabs, active?, onChange? })\` | \`tabs: [{ id, label, icon?, tooltip?, content }]\`, \`content\` a node or an array. \`active\` is reactive and defaults to the first tab. |
| \`Setting({ name, desc?, children })\` | A settings row: name and description on the left, the children as its control. |

\`\`\`js
const row = new Row([new Badge('3 open'), new Button({ text: 'Refresh', onClick: () => refresh() })])
v.body = new Stack([new Section({ title: 'Today', desc: 'What is due', children: [row] })])
\`\`\`

### Content

| Class | Props |
|---|---|
| \`Markdown(text \\| { text?, file?, filePath?, onClick? })\` | Obsidian's own renderer: links, images, \`![[embeds]]\` and \`::abele-gallery::\` blocks all work. \`file\` renders that note and re-renders when it changes; \`filePath\` is what relative links in \`text\` resolve against — give it the note's path when \`text\` came out of a note. |
| \`Text(text \\| { text, muted?, small? })\` | A paragraph. |
| \`Image({ src, alt?, fit?, onClick? })\` | \`src\` is a vault path, the name a note links a file by (\`poster.jpg\`, as in \`![[poster.jpg]]\`) or a URL; \`fit\`: \`contain\` (default) \`cover\` \`natural\`. |
| \`Table({ columns, rows, onRowClick? })\` | \`columns: string[] \\| { key, label }[]\`; \`rows: (string \\| node)[][] \\| Record<string, string \\| node>[]\`. |
| \`Badge(text \\| { text, accent? })\` | A small label. |
| \`EmptyState(text)\` | What to say when there is nothing to show. |

\`\`\`js
const table = new Table({ columns: ['Note', 'Words'], rows: [['Inbox.md', '412']] })
v.body = [new Markdown({ file: 'Notes/Today.md' }), table, new Text('Counted just now', { muted: true })]
\`\`\`

A \`Table\` row given as an array is matched to the columns in order, whether it was passed to
the constructor or assigned later. An object row is keyed by column: \`table.rows =
[{ Note: 'Inbox.md', Words: '412' }]\`. A row may carry keys no column shows — \`onRowClick\`
receives the whole row as the script wrote it, which is the tidy way to keep a path beside what
is on screen. A cell may also be a node rather than a string.

Inside a script, \`Text\` and \`Image\` are these classes: they shadow the browser globals of the
same name.

Reserved names: \`view\`, \`Stack\`, \`Row\`, \`Grid\`, \`Section\`, \`Tabs\`, \`Setting\`, \`Markdown\`,
\`Text\`, \`Image\`, \`Table\`, \`Badge\`, \`EmptyState\`, \`Button\`, \`Icon\`, \`Input\`, \`Select\`,
\`Checkbox\`, \`Search\`, \`Card\` and \`Html\` are already declared in every script — a script that
declares one of them itself (\`const view = …\`) fails to start with a message naming it.

### Controls

| Class | Props | Events |
|---|---|---|
| \`Button({ text, icon?, accent?, warning?, disabled?, tooltip?, onClick? })\` | | \`click\` |
| \`Icon({ icon, tooltip, disabled?, onClick? })\` | \`tooltip\` is required — an icon with no name is a guess. | \`click\` |
| \`Input({ value?, placeholder?, textarea?, rows?, disabled?, onInput?, onChange?, onEnter? })\` | \`value\` is reactive both ways. | \`input\` (every keystroke), \`change\` (blur or enter), \`enter\` |
| \`Select({ options, value?, onChange? })\` | \`options: string[] \\| { value, label }[]\`; \`value\` defaults to the first. | \`change\` |
| \`Checkbox({ checked?, label?, onChange? })\` | | \`change\` |
| \`Search({ value?, placeholder?, suggest?, onChange? })\` | \`suggest\`: \`file\` \`folder\` — Obsidian's own suggester. | \`change\` |
| \`Card({ title?, cover?, large?, subtitle?, description?, meta?, badges?, actions?, children?, selected?, onClick? })\` | Clickable when it has a click handler. \`cover\` is a picture across the top (path, link name or URL); \`large\` makes the title a heading and the description body text — a post in a feed rather than a tile in a grid. \`badges\` are \`Badge\` nodes next to the title, \`actions\` are nodes in the top-right corner, \`children\` come after the description. | \`click\` |

\`\`\`js
const query = new Input({ placeholder: 'Search', onEnter: () => search(query.value) })
v.body = [new Row([query, new Button({ text: 'Run', accent: true, onClick: () => search(query.value) })])]
\`\`\`

\`button.click()\` calls the same handlers a press does, which is how a keyboard shortcut and a
button stay one piece of code.

### Raw

\`Html({ html, on?, children?, onMount? })\` renders \`html\` as the node's own markup, for what the
catalogue does not cover.

- \`on: { 'click .selector': fn }\` — one delegated listener per event on the node's root;
  \`fn(event, matchedElement)\`. Also \`.on('click', fn, '.selector')\`, and without a selector the
  listener is on the root.
- \`children: { '.selector': node }\` — a node from the catalogue mounted inside the matched
  element. The script's markup and the kit compose.
- \`onMount(el)\` — the root element after insertion, for anything else. \`el\` is real DOM, in the
  leaf's own window.
- \`<img src="Attachments/a.jpg">\` and the other media elements: a \`src\` that is a vault path or
  a link name is turned into a URL the browser can load. A URL is left alone.

---

## Your own markup and CSS

\`html\` goes through Obsidian's \`sanitizeHTMLToDom\`, which is the sanctioned way to insert
markup. It strips \`<script>\` and inline \`on*\` attributes, so \`onclick="…"\` will simply not be
there: use \`on:\` delegation for events. Classes, data attributes and structure survive.
Escape anything that came out of a note before putting it in \`html\`.

\`v.style(css)\` scopes CSS to this view. Every selector is prefixed with the view's root, so
nothing leaks out to the rest of Obsidian:

\`\`\`js
v.style(\`.post { border-left: 3px solid var(--interactive-accent); padding-left: var(--size-4-3); }\`)
\`\`\`

- A selector that is exactly \`:root\`, \`html\` or \`body\` becomes the view's root, so custom
  properties declared there (\`:root { --accent: … }\`) apply inside the view and nowhere else.
  Anything longer is prefixed as written, so \`body .post\` becomes \`<view> body .post\` and
  matches nothing. Put a class on your own markup and target that.
- \`@media\`, \`@supports\` and \`@container\` are recursed into. The at-rules that hold
  declarations rather than rules — \`@keyframes\`, \`@font-face\`, \`@page\`, \`@property\`,
  \`@counter-style\`, \`@font-feature-values\` — are copied through untouched.
- The parser walks braces and commas as structure and does not read quoted strings, so a brace
  or comma inside a value (\`content: "}"\`) confuses it. Write those escaped: \`content: "\\007D"\`.
- Obsidian's variables reach in. Use them — \`var(--text-muted)\`, \`var(--size-4-2)\`,
  \`var(--interactive-accent)\`, \`var(--background-modifier-border)\` — rather than colours and
  pixels of your own, so the view follows the user's theme.

---

## Making it look right

The kit is what makes a view look like the rest of Obsidian. Every time a script draws its own
version of something the kit has, the result is a different size, a different colour and a
different shape from the button beside it. The rules the plugin holds itself to:

- **A node from the catalogue before your own markup.** \`Html\` is for a layout the catalogue
  lacks — a timeline, a grid of tiles, a two-column spread — and for nothing else. Inside it,
  put the kit's nodes into slots with \`children\`: \`children: { '.actions': new Row([open, later]) }\`.
- **Never a bare \`<button>\`.** Obsidian styles every \`<button>\` itself, and its rule beats
  yours, so a hand-drawn button comes out a different size from a \`Button\`. The same goes for
  \`<input>\` and \`<select>\`: use \`Input\`, \`Select\`, \`Search\`.
- **One accent per group of buttons.** \`accent: true\` marks the one action the person came
  for; the others stay plain. \`warning\` is for an action that destroys something — deleting
  a note, not hiding or snoozing a card.
- **A toolbar is one row.** The one primary action as a \`Button\`, the secondary ones —
  back, refresh, rescan, settings — as \`Icon\`s with tooltips, a \`Select\` for the mode, a
  \`Badge\` for the count. A search box searches on \`onEnter\`; it does not need a Find
  button beside it, nor a Reset one. Three rows of wrapped buttons is not a toolbar.
- **A card has at most three buttons.** Open, and two more; anything else is an \`Icon\` or
  goes in a menu. Four buttons wrap into two rows on a phone.
- **A feed or a list of notes is \`Card\`s in a \`Stack\`.** \`cover\` for the picture, \`large\` for
  a post, \`badges\` for tags, \`description\` for an excerpt or a \`Markdown\` child for the
  rendered text, a \`Row\` of \`Button\`s among the \`children\` for what can be done with it.
  \`Grid\` is for tiles that sit side by side.
- **Ask \`noteInfo(path)\` for what a note is.** It returns the title, the dates, the tags, the
  cover as a real vault path, the body without frontmatter, the prose without markup and an
  excerpt of it. Cutting frontmatter and pictures out of \`read()\` by hand is how a card ends
  up showing \`::abele-gallery::\` as text and a broken image where the poster should be.
- **No sizes or colours of your own.** Obsidian's variables — \`var(--size-4-2)\`,
  \`var(--text-muted)\`, \`var(--radius-m)\`, \`var(--font-ui-small)\` — follow the theme; a
  \`18px\` radius and a \`#333\` do not. A picture's height is the picture's own: \`Image\`
  and \`Card\`'s \`cover\` size themselves, and a box with \`height: 42vh\` around one is a
  grey wall when the picture is missing.
- **A toolbar starts at the left.** \`Row\` already lines its children up; \`justify: 'center'\`
  moves the whole toolbar to the middle of the screen. Group the controls that belong
  together in one \`Row\`, with \`gap: 'small'\`, and let it wrap.
- **Look at it.** \`inspect_view\` shows the tree you built; \`screenshot\` with \`view\` shows
  what is on screen right now, the way the person sees it. Take one after the first build and
  after every change to the layout — a view that reads well as a tree can still wrap its
  toolbar into three rows.

---

## Handlers and errors

- Handlers may be async. Every one is wrapped: a throw or a rejection goes to a dismissable
  error strip at the top of the view and to the console, and the view keeps working. Read them
  back from \`v.errors\`.
- Handlers run after the script's run has ended, and everything in the script is still in
  scope: \`read\`, \`find\`, \`create\`, \`agent\`, \`notice\`, \`open\`, \`runScript\`.
- \`form()\` and \`show()\` work once the view is open — they open the usual modal over it, because
  a handler runs when the user presses something. Before that, a run that was not started from
  the command palette still cannot use them.
- \`log()\` from a handler is appended to the run that opened the view, under **Show script
  runs**, even though that run has finished. For the console use \`console.log\`.
- \`signal\` in the script closure is the *run's* signal, and nobody aborts it once the run ends.
  \`v.signal\` is the one a handler checks — it aborts when the tab closes.
- \`v.every(ms, fn)\` is the timer to use. It is cleared with the view, so nothing keeps ticking
  against a tab that is gone.

---

## Looking at what you built

\`inspect_view\` with \`view: '<tab title or script name>'\` prints the tree as the script built
it — node per line, children indented, with the values worth asking about:

\`\`\`
View "Flashcards · Decks/German" — script "Flashcards", params {"deck":"Decks/German"}, state {"index":3}
Row
  Badge "4 / 20"
Card
  Markdown "der Hund — the dog"
Row
  Button "Flip" accent
  Button "Next" icon=arrow-right
\`\`\`

A name that matches nothing lists the views that are open, including ones still starting or
failed. Hidden nodes print \`(hidden)\`, ids print as \`#id\`, and \`Html\` prints its raw markup.
Output is cut at 15 000 characters — inspect a smaller view, or reach one node by its \`id\`.

\`screenshot\` with \`view: '<title or script>'\` is a picture of the view as it is on screen at
this moment: the visible part of the tab, at the scroll position the person left it at. What
is scrolled out of sight is not in the picture, and a tab that is not showing — behind another
tab, or in a collapsed sidebar — cannot be captured at all; the tool says so, and the person
decides what to bring on screen.

---

## Examples

### A feed of notes

\`\`\`js
// @name Feed
// @description Posts as a timeline, newest first
const paths = await find({ property: 'type', value: 'post', limit: 200 })
const notes = await Promise.all(paths.map((p) => noteInfo(p)))
notes.sort((a, b) => b.created.localeCompare(a.created))

const v = view({ title: 'Feed', icon: 'newspaper' })
const post = (n) =>
  new Card({
    title: n.title,
    large: true,
    cover: n.cover ?? undefined,
    subtitle: dayjs(n.created).format('D MMM YYYY'),
    badges: n.tags.slice(0, 3).map((t) => new Badge(t)),
    description: n.excerpt,
    meta: [n.folder, \`\${n.words} words\`],
    children: [
      new Row({
        gap: 'small',
        children: [
          new Button({ text: 'Open', icon: 'file-text', accent: true, onClick: () => open(n.path) }),
          new Button({ text: 'Later', icon: 'clock', onClick: () => (v.state.later = [...(v.state.later ?? []), n.path]) }),
        ],
      }),
    ],
  })
v.body = new Stack({ gap: 'large', children: notes.map(post) })
v.on('vault', (e) => { if (e.path.endsWith('.md')) notice('Feed is stale: ' + e.path) })
await v.open()
\`\`\`

Everything on the card is the kit's: the buttons are the same buttons as the rest of the
plugin, the cover is a real vault path, and the excerpt has no frontmatter or gallery marker
in it, because \`noteInfo\` took those off. For the whole note rendered — links, pictures,
galleries — put \`new Markdown({ text: n.body, filePath: n.path })\` among the children.

### A dashboard that refreshes as the vault changes

\`\`\`js
// @name Open tasks
// @description Notes with status: open, refreshed as the vault changes
const v = view({ title: 'Open tasks', icon: 'list-checks' })
const table = new Table({ columns: ['Note', 'Folder'], rows: [] })
const count = new Badge('')
async function refresh() {
  const paths = await find({ property: 'status', value: 'open', limit: 200 })
  table.rows = paths.map((p) => ({
    Note: p.split('/').pop().replace(/\\.md$/, ''),
    Folder: p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '',
    path: p,
  }))
  count.text = \`\${paths.length} open\`
}
table.on('rowClick', (row) => open(row.path))
v.on('vault', (e) => { if (e.path.endsWith('.md')) refresh() })
v.body = [new Row([count, new Button({ text: 'Refresh', icon: 'rotate-cw', onClick: refresh })]), table]
await refresh()
await v.open({ where: 'sidebar' })
\`\`\`

The \`path\` key is in every row and in no column: the table shows a name and a folder, and the
row handler still has the path to open.
`
