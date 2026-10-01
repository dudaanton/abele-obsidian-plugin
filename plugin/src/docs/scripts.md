# Scripts

Scripts are JavaScript files in the vault's scripts folder that run inside Obsidian with full
vault access. They are how a person automates something too specific for a feature, and how an
agent leaves behind something repeatable instead of doing the same work again next week.

## Saved keys

Using `${abele_key:name}` in `ctx.fetch`, `ctx.downloadImage` or `ctx.downloadFile` opens a
confirmation when the origin is not yet allowed for every named key on this device. It shows
the keys and recipient, without their values. **Allow address and send** remembers that origin
for those keys; later requests to it do not ask again. Different paths and query strings share
the same origin, but another host, scheme or port needs its own approval. Cancelling sends
nothing; Stop dismisses the question. A saved key cannot be used in the URL's authority.
A script-started agent cannot make requests requiring this interactive approval.

For a literal Authorization or API-key header sent over home-network HTTP, open **Review key
destinations**, enter the address and choose the concrete saved key (or explicitly save a new
named key with exactly that header's key material). **Allow key and address** approves only this
key and canonical recipient and the device-local unencrypted transport. Retry the unchanged
script yourself; approval never replays it. Different keys, hosts or ports remain unapproved.
Key values are never written to the destination list or ordinary settings.

For Basic authentication use the same explicit option on `ctx.fetch`, `ctx.downloadImage`
and `ctx.downloadFile`:

```js
await ctx.fetch('http://192.168.55.18:8764/stats', {
  basicAuth: { username: 'sample-user', password: '${abele_key:sample-password}' },
})
```

Save only the password under that name; Abele resolves and encodes it after consent. Do not
put the password into chat or save a Base64 duplicate. Do not combine `basicAuth` with an
Authorization header, use colons in the username, or put credentials/placeholders in URL
userinfo. Existing literal `Authorization: Basic base64(username:password)` scripts can be
retried unchanged after permission for the saved password and canonical recipient. Derived
headers, their Base64 payloads and raw passwords are redacted in results and network errors.

## Network limits

`ctx.fetch` waits at most five minutes, including redirects, and accepts at most 20 MB.
Its `timeout` option can shorten that wait, not remove the cap. Other buffered requests default
to 30 seconds and 20 MB. Desktop requests stop reading at the size limit; on mobile the native
transport buffers first, so the plugin can only refuse the completed response. A timed-out
mobile request can still finish in the platform, but its answer is not used.

## Agents started by scripts

`ctx.agent()` uses the target agent's own scope and permission mode, not the global mode or
whichever chat is open. Anything an ordinary chat would ask about is refused: Ask tools,
out-of-scope source files, edits under confirm-all, and deletes/moves/copies without allow-all.
Auto feature tools still run, including explicitly automatic memory. These rules also apply
when an automation starts the script; direct script operations keep their existing access.

## Archive extraction

`unzip()` validates every entry before writing any of them. Entries cannot escape the target
folder or use absolute paths. Limits are 64 MB compressed, 512 MB total unpacked, and 5000
entries; a metadata-only pass checks allocation bounds before any payload is copied or
inflated. STORE entries count their stored byte sizes even when unpacked sizes are understated
or multiple entries share one payload. Ordinary nested and hidden files inside
the target still extract. The path/size validation is storage-independent.

## Execution trust

Every entry point reads the current full file, not discovery-cached source. Managed snapshots
are hashed and require device-local permission for that exact connection, remote file identity and
SHA. Shared/agent connections refuse execution. Missing or unknown provenance blocks a run;
rename, restore, adoption, a nested call or an automation cannot bypass the common gate.
Ordinary local scripts in a vault that has never been sync-managed continue to run locally.

Personal managed scripts use **until confirmed**: run one manually from the script library or
command palette to review its full source, file identity, connection and SHA-256. **Approve
and run** stores permission for those exact bytes on this device. A changed file/identity or
connection while the dialog is open invalidates the decision. Checks use this vault's actual
current connection, not only the provenance descriptor last written by an engine. Switching
connections with a join question still open invalidates old decisions before a new engine
exists; disconnect retains managed bytes but does not keep an old connection's permission
active. Every managed identity/hold mutation advances a shared per-path runtime generation
before its asynchronous write begins. A pending or changed generation invalidates checks
across the awaited approval read and the synchronous compilation boundary; different paths
do not invalidate one another. The fence is shared across this runtime's IDB connections,
not reconstructed as permission after a reload. New bytes need a new decision;
rename preserves identity at the proven destination. The old path retains a restrictive
managed hold, not the moved identity; recreating it with identical bytes cannot reuse approval.
Recorded path spelling also protects case-only renames in the case-folded ledger namespace. Shared/agent policy is **refuse**, with no approval bypass.
Agents, automations, nested scripts and restored views never open approval dialogs: unapproved
runs return a hold/error. Approving on one device does not authorize another, and nothing in
settings transfer carries these permissions. This execution policy does not disable note-event
automations; their event handling is independent of code approval.

## The header

Every script starts with a comment block declaring what it is. Without `@name` the file is
ignored.

```
// @name Tag untagged notes
// @description Finds notes without tags and adds one
// @icon tag
// @param tag string "Tag to add" = "todo"
```

A script with parameters asks for them in a form when a person runs it, and takes them as
arguments when an agent or another script calls it.

## Writing one

Call `script_api_docs` before writing a script. It is the full reference for what is in scope —
file operations, `find`, templates, `agent`, `fetch`, forms, `show` — and none of it is
guessable. A script is an async body: `return` a string and that is its result; `log()` as it
goes and those lines are its output.

Where a script asks a person for something longer than a word — a description, an entry, a
list — the field can be Obsidian's own note editor rather than a text box: `type: "note"` in a
`form()`, `NoteInput` in a view. Links with `[[`, formatting and checklists work in it, and on a
phone Obsidian's toolbar stands above the keyboard while it is typed in, as in a note. What it
gives back is the markdown written in it.

Where the answer is one of the person's notes — a wallet, a person, a project — the field is a
note picker: `type: "note-picker"` in a `form()`, `NotePicker` in a view. It searches as the
quick switcher does, only among the notes its `filter` lets through, written in `find()`'s words
(`{ property: "type", value: "account" }` for the finance wallets). It gives back a path, or a
wikilink with `returns: "link"`, and a list with `multiple`; `create` lets the person make the
note they were looking for when it is not there yet.

A script that needs numbers — totals, averages, a trend, a correlation — takes them from
`analytics` rather than adding them up itself: `analytics.analyze(spec)` answers exactly what
`analyze_data` does, as an object, and money totals come out exact to the cent. The spec is the
`analytics` section of this reference.

## Books (reader library)

`books.list()` returns snapshots of **every reader-compatible file** in the vault, not book
notes: EPUB, MOBI, AZW, AZW3, FB2, FBZ, CBZ and PDF. `books.get(path)` returns one or `null`.
Both read the file inventory and the existing positions JSON, **never the book binaries**.
Paths are identities; sorting/filtering is up to the script. `book` (singular) is instead the
selection context of a script run from a reader tab. A lint rule cannot use `books`.

Each row has `path`, `format`, `title` and `author` (`null` until cached by a normal reader
open), `position` (`{ cfi, fraction, at }` or `null`), `progress` (fraction 0–1 or `null`),
`pageCount`, `currentPage`, `pageUnit` (`'locations'`, `'pages'`, or `null`), `finished`,
`lastOpenedAt`, `lastPositionAt`, `highlightCount`. Times are epoch milliseconds; the last
position time advances on a changed CFI, while opening a book advances the separate opened
time. `position.at` equals `lastPositionAt`. Progress zero is a real saved position, not null.
Completion is inferred only at progress 1; reading backward may unset it. A whole-book
location is about 1,500 bytes of text, **not a printed page**; fixed-layout/PDF counts are
actual pages. `currentPage` estimates `ceil(progress * pageCount)`, clamped to 1–count.
Unopened books have null counts: listing does not parse books to backfill. Highlights are
null unless a currently open reader has indexed them (zero means indexed and empty).
No cover, book-note metadata, attachment or file-finding flow is part of this reader API.

`await books.open(path)` reveals an existing Abele reader tab or opens a new one (including a
PDF when automatic PDF takeover is off), leaving the dashboard tab alone. The reader restores
its newest saved place. `books.onChange(callback, { signal: v.signal })` invalidates a script
view on local page turns, external reader-data changes, vault file events and tab layout changes
(including a reader closing and its highlight count becoming unavailable). Subscribe before
fetching; the callback fetches again. Unsubscribe is idempotent; closing the view aborts its
signal. `v.on('focus', refresh)` or a Refresh button also recover changes made while the app
was closed. Results are detached, read-only snapshots, not setters.

```js
// @name Reader shelf
const v = view({ title: 'Reader shelf' })
let items = [], busy = false, again = false, query = ''
const card = (b) => new Card({
  title: b.title || b.path.split('/').pop(),
  subtitle: b.author || 'Author unavailable',
  description: b.progress === null ? 'No saved position' :
    (b.finished ? 'Finished' : Math.round(b.progress * 100) + '% read') +
    (b.currentPage ? ` · ${b.pageUnit === 'locations' ? 'Location' : 'Page'} ${b.currentPage} of ${b.pageCount}` : ''),
  actions: [new Button({ text: b.position && !b.finished ? 'Continue' : 'Read',
    onClick: () => books.open(b.path) })],
})
function draw() {
  const reading = items.filter(b => b.progress !== null && !b.finished)
  const latest = [...reading].sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0))[0]
  const visible = items.filter(b => (b.title || b.path).toLowerCase().includes(query) ||
    (b.author || '').toLowerCase().includes(query))
  v.body = [new Text(`${items.length} files · ${reading.length} reading · ${items.filter(b => b.finished).length} finished`),
    new Search({ placeholder: 'Search title, author or path', value: query,
      onChange: value => { query = String(value).toLowerCase(); draw() } }),
    ...(latest ? [new Text('Continue reading'), card(latest)] : []),
    new Grid(visible.map(card)), new Button({ text: 'Refresh', onClick: refresh })]
}
async function refresh() {
  if (busy) { again = true; return }
  busy = true
  try { do { again = false; const next = await books.list()
    if (v.signal.aborted) return
    items = next; draw()
  } while (again) } finally { busy = false }
}
books.onChange(() => v.run(refresh), { signal: v.signal })
v.on('focus', () => v.run(refresh))
await v.open()
await refresh()
```

## Running one

Six ways in: the command palette, a button in a note's header (a script button, or a command
button set to the script's command — `headerButtons` in the settings reference), an `abele://` link, an
agent calling the `script_<name>` tool, an automation when something happens to a note, or the
book reader's bar on selected words, which gets the words, their sentence and a link to their
place as `book`. What that bar offers first is the book menu: the scripts the person chose in
Settings → Books (`reader.selectionScripts`) or pinned from its script list, then those
whose header has `// @book`. Up to three are a button each, more fold into one menu, and any other
script is picked from the list. A script can call another with `runScript`.

Book runs also receive read-only `selection`: `text`, `sentence`, `title`, `pathHint`,
`backlink`, and `source` (`kind: 'book'`, `place`, `chapter`, `language`). The legacy `book`
API is unchanged. The shared runtime's chat adapter carries `kind: 'chat'`, chat/message/revision
identity, author/role, exact rendered range, quote, projection version and surrounding context,
plus a durable anchor ID and backlink. It reviews the script and completes forms before validating
and saving that anchor. A stale revision returns a conflict; a failed save exposes no backlink to
execution. Chat-selection launch is not enabled in the UI yet, and does not impersonate the
interceptor's `chat` or `message`. Selection and run/rerun state retain the captured source rather
than consulting current tabs or DOM selection. Ordinary runs find `selection === null`; scripts
can shadow that name. Selection has no binding operation and does not edit chat messages.

The toolbar is the same idea for notes. A script whose header has `// @toolbar`, or which the
person pinned from the script library (`ai.toolbarScripts`, by name), is an icon on Obsidian's
left ribbon on a computer — its own icon, its name as the tooltip, pressed it runs on the note in
front and whatever is selected in it, as from the command palette — and is put at the start of the phone's
toolbar above the keyboard, Obsidian's own `mobileToolbarCommands`. That list belongs to the person
as much as to the plugin: only what the plugin put there is taken off again, and a script the
person took off by hand is not put back unless it is pinned again. Every script is a command
(`Script: <name>`) whether or not it is on the toolbar, so it can have a hotkey and be put on the
phone's toolbar by hand too. A ribbon item is named by the script's file (`abele:script:<path>`),
so renaming the script keeps its place and whether it was hidden in Obsidian's ribbon settings,
where these items are reordered and hidden like any other. Nothing is added to notes' headers.

A script can also run each time the plugin starts — Obsidian opening, and also the plugin being
reloaded or updated, which is the same start from where the plugin stands; switching scripts on
later in a session runs nothing. Those are the scripts on the startup list (`ai.startupScripts`,
each `{ script, devices }` with `devices` one of `both`, `desktop`, `mobile`), in its order, then
those whose header has `// @startup` (or `// @startup desktop`, `// @startup mobile`), by name.
They start once the workspace is laid out, the script index is read and Obsidian has read the
notes, and run one after another. A script's parameters are its defaults: one that needs a value
with no default is skipped with a notice, and a `form()` inside a startup script is answered as
if dismissed (`null`). One that throws is a failed run and a console warning naming it; one still
running after 30 seconds is named in a warning and the next starts while it goes on in the
background. `ai.startupScriptsPaused` skips them all. The script running at startup is also kept
on the device while it runs, so one that froze the app is skipped, once, at the next start, with a
notice. Runs started this way are listed as `startup` in the list of runs.

With `ai.confirmForeignScripts` on, a script that appears or changes without being written on
this device — through Obsidian Sync, iCloud, Syncthing, git — waits to be confirmed on this device.
The whole file counts, header included. Until it is confirmed, automations, startup, agents, a
script's `runScript`, a script view and a lint rule do not run it (a run fails saying it waits,
and an agent is not offered it as a tool); a button, the command palette, a link or the book menu
show it to the person first, as a diff against the version last confirmed here, and run it once
confirmed. A script written on this device — in the code editor, by the agent's file tools, from
a script, by a transfer taken in here — counts as confirmed. Switching it on takes every script
as it is then.

The **Scripts** page of the plugin's settings lists every script as a card — its `@icon`,
`@name`, `@description` and parameters, straight from the header above — and runs one,
makes a header button for it, pins it to the toolbar, or puts it on the startup list from there
(its **Startup** tab orders that list and holds the switch that skips it). That header is therefore also how a script presents
itself to the person: a script without `@description` shows up saying it has none.

## Lint rules

A script whose header has `// @lint` (or `// @lint warning`) is a rule of the linter, listed in
Settings → Linter beside the built-in ones as `script:<name>`, and neither a command nor a
`script_<name>` tool. It declares `check(note)` — returning a list of messages, or of
`{ message, line, fixable }` with `line` counted from 1 over the whole file — and may declare
`fix(note)`, returning the note's whole new text or `null`. `note` carries `path`, `name`,
`folder`, `content`, `lines`, `frontmatter` (parsed, or `null` when missing or unreadable),
`frontmatterError`, `frontmatterEnd`, `body`, `bodyStart`, `ctime` and `mtime`; changing it
changes nothing. A lint script only reads: `read`, `ls`, `find`, `noteInfo`, `listTemplates`,
`log` and `dayjs` work, and every call that would write, ask, open or fetch throws — the only
way it changes a note is the text `fix` returns, written by `lint_fix` or the linter's tab. The script is run once when a lint starts, and `check` then once per note, so it
does no I/O of its own per note. Asked to add a rule the built-ins do not cover, write one of these
with `create_script`; `lint` shows what it finds.

## Automations

A script can also run by itself when something happens to a note. The **Automations** tab of
the Scripts page holds the rules: when (a task completed, reopened, created, changed or given
another date; a note created, changed, renamed or deleted), on which notes (note types — task
events are about tasks already — folders, one frontmatter property equal to a value), which
script with which parameter values, and at most how often for one note. The parameters are
templates like a header button's: `{{title}}`, `{{path}}`, `{{event}}` and the note's
frontmatter fields. A finance transaction being created is a note of type `transaction` being
created.

The script finds what happened in `event` — the kind, the note's path, its frontmatter before
and after, which properties changed; `script_api_docs` has the whole shape. A run started this
way is listed under **Show script runs** with the event beside it, and a failure is a failed
run there plus one notice, never an error thrown at the person.

What keeps them from running away: a script's own writes never set off the automation that
ran it; one automation's write setting off another stops after three in a row; changes to one
note within the interval are gathered into one run at its end; and more than 30 runs in a
minute pause every automation until one of them is edited or Obsidian restarts. They do not
run while the settings file could not be read.

An automation runs on the device where the change was made. A change that arrives by sync —
or from another app, or while Obsidian was closed — runs nothing, because the device where it
was made has run it already; a rule can opt in to those with **Also for changes from other
devices**. The difference is told by how the file changed: a write made here goes through
Obsidian's vault, and one that arrives does not.

## Watching one

Every run of this session is listed under **Show script runs**: its status, when it started,
how long it took, each `log()` line with the time it was printed, and what it returned or how
it failed. From there a run can be stopped, run again with the same values, or run as new with
the values open to change. Nothing about a run is written to the vault, and the list is gone
when Obsidian closes.

While a script is running the status bar says so; clicking it opens the list.

## Views

A script can open a tab of its own and fill it with components — cards, buttons, inputs,
markdown, tables, its own HTML and CSS — and its handlers keep running after the script has
returned. This is the shape for anything a person will look at and press, rather than read
once: a feed of notes, flashcards, a dashboard that refreshes as the vault changes. `show()`
is for a result; a view is for an interface. The reference is `script_api_docs` with
`section: 'views'`. `inspect_view` with `view: '<title>'` reads the view back as the tree the
script built; `screenshot` with the same `view` takes a picture of the part of it that is on
screen right now — only that part, and only while the tab is showing.

A view's tab is saved with the workspace: after a restart the plugin runs the script again
with the same parameters and the state the view had, so a script that keeps its place keeps
it across a restart too.
