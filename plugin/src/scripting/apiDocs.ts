/**
 * What a script can call, written once for both readers.
 *
 * The agent asks for this through the `script_api_docs` tool before it writes a script; a
 * person asks for it through the "Show script API reference" command, which renders it as
 * markdown in a modal. Same text either way — two copies would drift, and the one the person
 * reads would be the stale one.
 */
export const SCRIPT_API_DOCS = `# Script API Reference

Scripts are async JavaScript functions that run with full vault access (no scope restrictions).
All functions below are available as top-level globals — no imports needed.
Use \`return\` to output a result string.

---

## Header Format

Every script must start with a comment block declaring its metadata:

\`\`\`js
// @name My Script Name
// @description What the script does
// @icon lucide-icon-name
// @param paramName string "Required string parameter"
// @param count number? "Optional number parameter"
// @param dryRun boolean? "Optional flag (shown as toggle in UI)"
// @param style string "CSS style" = "bold"
// @param limit number? "Max results" = 50
// @param verbose boolean? "Verbose output" = true
// @book
\`\`\`

- \`@icon\`: Lucide icon name for toolbar display (e.g. \`scroll-text\`, \`sparkles\`, \`wand\`). Defaults to \`scroll-text\` if omitted. See https://lucide.dev for available icons.
- Parameter types: \`string\`, \`number\`, \`boolean\`, \`text\`
- Add \`?\` after type for optional (e.g. \`number?\`)
- Boolean params are rendered as toggles, not text inputs
- Default values: add \`= value\` after description. Use quotes for strings with spaces: \`= "my value"\`
- Defaults pre-fill the form UI and are used as fallback when the param is not provided (e.g. via link URL)
- Add \`selection\` after description/default to auto-fill from editor selection: \`// @param text string "Input text" selection\`. Run on words in a book, it is filled with those words
- \`@book\`: the script gets a button of its own on the book reader's selection bar (any script can be run there through "Run a script on these words"); see \`book\` below
- Parameters are available via the \`params\` object (e.g. \`params.paramName\`)

---

## Workspace

| Function | Returns | Description |
|----------|---------|-------------|
| \`activeNotePath()\` | \`string \\| null\` | Get the file path of the currently active note (null if no note is open) |

---

## File Operations

All async. Full vault access — no scope restrictions.

| Function | Returns | Description |
|----------|---------|-------------|
| \`read(path)\` | \`string\` | Read file content |
| \`edit(path, oldString, newString)\` | — | Replace first exact match of \`oldString\` with \`newString\` |
| \`write(path, content)\` | — | Overwrite entire file with new content |
| \`create(path, content)\` | \`string\` | Create new file (parent folders created automatically). Returns the path it was created at |
| \`remove(path)\` | — | Move file to trash |
| \`move(from, to)\` | \`string\` | Move or rename a file. Returns where it ended up |
| \`copy(from, to)\` | \`string\` | Copy a file. Returns where the copy ended up |

A name cannot carry \`* " \\ / < > : | ?\`, nor \`#\`, \`^\`, \`[\` or \`]\` — a wikilink cannot point
past those. They are taken out rather than refused, which is why these three return the path:
use what comes back, not the string you passed.
| \`ls(path?)\` | \`string[]\` | List folder contents (file/folder paths). Omit path for vault root |
| \`find(opts)\` | \`string[]\` | Search files (see below) |
| \`replace(path, actions)\` | \`string\` | Apply replacement actions to a file (see below) |
| \`open(path)\` | — | Open a file in the Obsidian editor |
| \`setCover(notePath, mediaPath?)\` | — | Set cover image for a note. If mediaPath omitted, uses first media embed in note. Handles video thumbnails automatically |
| \`noteInfo(path)\` | \`object\` | What a note is, ready for a card (see below) |

### noteInfo(path)

Everything a script wants to know about a note before it shows it, without parsing the file:

\`\`\`js
const n = await noteInfo('Notes/Aftersun.md')
// n.path, n.name, n.folder            — where it is
// n.title                             — frontmatter \`title\`, else the file name
// n.frontmatter, n.tags               — properties as objects; tags without \`#\`, frontmatter and body together
// n.created, n.modified               — ISO timestamps
// n.cover                             — frontmatter \`cover\`, else the first image embed, as a vault path — or null
// n.body                              — the markdown without frontmatter, for \`Markdown({ text: n.body, filePath: n.path })\`
// n.text                              — the prose: no markup, embeds or \`::abele-gallery::\` markers, lines kept
// n.excerpt                           — the first ~280 characters of \`text\`, cut at a word
// n.words
\`\`\`

Use it for a feed, a deck, a list: \`read()\` gives the file as written, and a card built from
that shows the frontmatter, the gallery marker and a link name where the picture should be.

### find(opts)

Supports both simple shorthand and advanced criteria:

**Shorthand** (fields are AND-combined):
\`\`\`js
await find({ name: "daily" })                        // name contains "daily"
await find({ property: "type", value: "task" })      // property equals value
await find({ content: "TODO" })                      // body contains "TODO"
await find({ folder: "Projects" })                   // anywhere under Projects/
\`\`\`

**Advanced criteria** — each criterion has \`type\`, \`operator\`, and optionally \`property\`/\`value\`:
\`\`\`js
await find({
  criteria: [
    { type: "property", operator: "equals", property: "type", value: "task" },
    { type: "property", operator: "notExists", property: "completed" },
    { type: "name", operator: "regex", value: "/2026-04/" },
  ],
  include_frontmatter: true,  // include YAML properties in results
  limit: 100,                 // max results (default 50)
})
\`\`\`

Criteria types: \`path\`, \`name\`, \`property\`, \`content\`
Operators: \`equals\`, \`contains\`, \`notContains\`, \`startsWith\`, \`endsWith\`, \`regex\`, \`exists\`, \`notExists\`
(\`exists\`/\`notExists\` only for \`property\` type)

Shorthand and criteria can be combined — they are merged.

### replace(path, actions)

Apply one or more replacement actions to a file. Actions are applied sequentially.

\`\`\`js
await replace("Notes/note.md", [
  { type: "set-property", property: "status", value: "done" },
  { type: "remove-property", property: "draft" },
  { type: "add-to-list", property: "tags", value: "reviewed" },
  { type: "remove-from-list", property: "tags", value: "pending" },
  { type: "replace-in-list", property: "tags", old_value: "old-tag", value: "new-tag" },
  { type: "replace-in-content", old_value: "old text", value: "new text" },
  { type: "replace-in-content", old_value: "/regex/gi", value: "replacement" },
  { type: "replace-in-property", property: "title", old_value: "old", value: "new" },
  { type: "move", directory: "Archive/" },
])
\`\`\`

Action types: \`set-property\`, \`remove-property\`, \`add-to-list\`, \`remove-from-list\`, \`replace-in-list\`, \`replace-in-content\`, \`replace-in-property\`, \`move\`.
\`old_value\` supports regex in \`/pattern/flags\` format for replace operations.
List values can contain \`;\` separator to add/remove multiple items at once.

---

## Templates

| Function | Returns | Description |
|----------|---------|-------------|
| \`applyTemplate(path, variables?)\` | \`string\` | Create note from template. \`variables\`: \`{ name: value }\` |
| \`listTemplates(type?)\` | \`string\` | List available templates, optionally filtered by type |
| \`createFromTemplate(templatePath)\` | — | Open the create-note-from-template modal for a specific template |

---

## Network

| Function | Returns | Description |
|----------|---------|-------------|
| \`fetch(url, opts?)\` | \`{ status, headers, data, text }\` | HTTP request |
| \`downloadImage(url, filename?)\` | \`string\` | Download image to vault, returns saved path |
| \`downloadFile(url, opts?)\` | \`string\` | Download any file to vault, returns saved path |

\`fetch\` options: \`{ method?, headers?, body?, timeout? }\`
\`downloadFile\` options: \`{ filename?, extension?, method?, headers?, body?, timeout? }\` — supports POST for APIs that return binary (e.g. TTS).
\`downloadImage\` options: \`{ filename?, headers?, timeout? }\`

\`timeout\` is milliseconds and takes any value — two seconds for a search API, twenty minutes for an export. Without it the call waits as long as the platform waits, which is what these have always done. It ends the *waiting*, not the request: a download that timed out may still land in the vault a moment later.
Secret substitution: use \`\${abele_key:name}\` in url, headers, or body to inject secrets configured in AI settings.

### Zip

| Function | Returns | Description |
|----------|---------|-------------|
| \`unzip(zipPath, targetFolder?)\` | \`string[]\` | Extract zip archive to vault, returns list of created file paths. Target folder defaults to zip filename without extension |

---

## AI

| Function | Returns | Description |
|----------|---------|-------------|
| \`agent(task, opts?)\` | \`string \\| string[]\` | Hand a task to an agent |
| \`agents()\` | \`object[]\` | List agents: \`{ id, name, description, utility }\` |
| \`generateImage(prompt, model?)\` | \`string\` | Generate image from text, returns vault path |

\`generateImage\` model parameter: optional \`"providerId::modelId"\` key from image generation settings. If omitted, uses the default image model.

\`agent\` options: \`{ agent?: string, items?: string[], batchSize?: number }\`
- \`agent\` — the name or id of the agent to run. Defaults to the agent new chats start on.
- \`items\` — fan out: one sub-agent per item, results returned in the same order.
- \`batchSize\` — how many run at once when fanning out (default 5, max 10).

The agent brings its own model, instructions, tools and scope. Call \`agents()\` to see what is configured.

\`\`\`js
const summary = await agent("Summarise this note", { agent: "Researcher" })
const each = await agent("Extract the date", { items: paths })
\`\`\`

---

## Scripts

| Function | Returns | Description |
|----------|---------|-------------|
| \`runScript(name, params?)\` | \`string\` | Call another script by name |

---

## UI

| Function | Returns | Description |
|----------|---------|-------------|
| \`notice(message, timeout?)\` | — | Show Obsidian notification |
| \`setStatus(text)\` | — | Say what the script is doing now — shown in the status bar and against the run |
| \`form(fields)\` | \`object \\| null\` | Ask for values: a dialog when a person runs the script from a command, note button, link or open view; a form handed to the agent from a chat |
| \`show(markdown, title?)\` | — | Show rendered markdown to read when a person runs the script or it has a view open |

\`form\` fields: \`[{ name, label, type?, options?, default?, required?, text?, filter?, multiple?, returns?, create?, placeholder? }]\`
Types: \`"text"\` (default), \`"textarea"\`, \`"note"\`, \`"note-picker"\`, \`"select"\`, \`"boolean"\`, \`"markdown"\`

A \`"note-picker"\` field chooses notes by typing, as in the quick switcher, out of the ones its
\`filter\` lets through. The filter speaks \`find()\`'s shorthand and criteria — \`name\`,
\`folder\`, \`property\`/\`value\`, \`criteria\` — except \`content\`, which it refuses. Its answer
is the note's path, or with \`returns: "link"\` a wikilink; with \`multiple: true\` a list of
them (an empty list when nothing is chosen). \`default\` takes the same. \`create: true\` offers
to make a note of a name nothing matches, in the filter's folder and carrying its property; it
is off unless asked. Asked from a chat, the agent is shown the notes it may choose from and a
note outside the filter is sent back to it.

\`\`\`js
const r = await form([
  { name: "wallet", label: "Wallet", type: "note-picker", filter: { property: "type", value: "account" } },
  { name: "people", label: "With", type: "note-picker", filter: { folder: "People" }, multiple: true, returns: "link" },
])
// r.wallet → "Finance/Accounts/Cash.md"      r.people → ["[[Anna]]", "[[Boris]]"]
\`\`\`

A \`"note"\` field is Obsidian's own note editor: links with \`[[\`, formatting, checklists and, on
a phone, Obsidian's toolbar above the keyboard. Its value is the markdown written in it. Use it
where the answer is a piece of a note — a description, a journal entry — rather than a word.

A \`"markdown"\` field asks for nothing: it renders \`text\` as markdown for the person to read
and select, and returns no value. Use it to explain a form, or to put a result beside the
questions. \`show(markdown, title?)\` is the same block on its own — prefer it over
\`notice\` for anything long: a notice is truncated, disappears, and cannot be selected.

### Views

A script can open a tab of its own — cards, buttons, inputs, markdown, tables, its own HTML
and CSS — and keep handling presses after the run has ended. Call \`script_api_docs\` with
\`section: 'views'\` for that reference. In short:

\`\`\`js
const v = view({ title: 'Hello' })
const b = new Button({ text: 'Press me', onClick: () => notice('Pressed') })
v.body = [new Markdown('# Hello'), b]
await v.open()
\`\`\`

---

## Globals

| Name | Type | Description |
|------|------|-------------|
| \`params\` | \`object\` | Resolved parameter values from the script header |
| \`event\` | \`object \\| null\` | What happened, when an automation started the run (see above) |
| \`book\` | \`object \\| null\` | The words in a book the script was run on from the reader (see below) |
| \`signal\` | \`AbortSignal\` | Cancellation signal — check \`signal.aborted\` in long loops |
| \`dayjs\` | \`function\` | [Day.js](https://day.js.org) date library — \`dayjs()\`, \`dayjs('2026-01-01').add(7, 'day')\`, \`.format('YYYY-MM-DD')\`, etc. |
| \`log(...args)\` | — | Append to script output. Objects are JSON-stringified |

\`log()\` output is captured and returned as the script result.
You can also \`return "result"\` directly.

### event — when an automation started the run

A script can be run by itself when something happens to a note (Settings → Scripts →
Automations). Such a run finds what happened in \`event\`; any other run finds \`null\` there.

\`\`\`js
event.kind        // what the automation waits for: 'task.completed', 'task.reopened',
                  // 'task.created', 'task.changed', 'task.date-changed', 'note.created',
                  // 'note.changed', 'note.renamed', 'note.deleted'
event.kinds       // every one of those this change was — completing a task also changes it
event.path        // the note; where it was, for a deleted one
event.oldPath     // before a rename
event.type        // its \`type\` frontmatter
event.before      // frontmatter before the change — null for a new note
event.after       // frontmatter after it — null for a deleted note
event.changed     // names of the properties that changed, added or removed
event.bodyChanged // whether the text below the frontmatter changed
event.origin      // 'local' — made on this device — or 'external', arrived by sync or from another app
event.rule        // { id, name } of the automation
\`\`\`

\`\`\`js
// @name Log completed task
// @param log string "Log note" = "Task log.md"
if (!event) return 'Meant to be run by an automation'
const line = '- ' + dayjs().format('YYYY-MM-DD HH:mm') + ' [[' + event.path.replace(/\\.md$/, '') + ']]\\n'
const text = await read(params.log).catch(() => null)
if (text === null) await create(params.log, line)
else await write(params.log, text + line)
\`\`\`

What the script writes does not set off the same automation again, and an automation set off
by another one's write stops after three in a row. A script that writes to the note it was
run for is therefore safe; one that writes to every note of the type it waits for is still
only run once per note per the automation's interval, and more than 30 runs in a minute pause
every automation until one is edited. \`event\` is not a reserved name: a script with its own
\`const event\` simply has its own.

### book — when run on words in a book

Select words in the book reader (or tap a highlight) and the bar under the page runs a script on
them: a script whose header has \`// @book\` has a button of its own there, and "Run a script on
these words" picks any other. Such a run finds the words in \`book\`; any other run finds \`null\`.
Parameters marked \`selection\` start out as the words, and the form is shown only when a
required one is still empty.

\`\`\`js
book.text      // the words selected, or the highlight's
book.sentence  // the whole sentence they are in (several, when the words run across them)
book.link      // a link to the place, as "Copy link" makes it: [[Dune.epub#cfi=…|Chapter 3]]
book.path      // the book's path in the vault
book.title     // the book's title
book.chapter   // the chapter — "Page N" in a PDF
book.cfi       // the place itself
\`\`\`

A note that holds \`book.link\` — in its text or in a property — is marked in the book: the words
get a dotted underline, and tapping them opens the note.

\`\`\`js
// @name Word card
// @book
// @param word string "Word" selection
if (!book) return 'Run it on words selected in a book'
const translation = (await agent('Translate "' + params.word + '" into English as used here, answer with the translation only:\\n' + book.sentence)).trim()
await create('Cards/' + params.word + '.md', '**' + params.word + '** — ' + translation + '\\n\\n> ' + book.sentence + '\\n> — ' + book.link + '\\n')
\`\`\`

Every function and global in this reference, and \`view\` with the component classes of the
view reference, is already declared in a script's scope: a script that declares one of those
names itself (\`const open = …\`, \`function find() {}\`) fails to start with a message naming it.

Every run is listed while Obsidian is open — its status, how long it took, each \`log()\` line
with the time it was printed, and what it returned — under **Show script runs**, where it can
also be stopped or run again. Nothing about a run is written to the vault.

---

## Examples

### Read and transform
\`\`\`js
// @name Summarize Note
// @description Create an AI summary of a note
// @param path string "Path to the note"
const content = await read(params.path)
const summary = await agent("Summarize this concisely:\\n\\n" + content)
await create(params.path.replace('.md', ' Summary.md'), summary)
return "Summary created"
\`\`\`

### Batch processing
\`\`\`js
// @name Tag Untagged Notes
// @description Find notes without tags and add a default tag
// @param tag string "Tag to add"
const files = await find({
  criteria: [
    { type: "property", operator: "notExists", property: "tags" },
    { type: "path", operator: "startsWith", value: "Notes/" },
  ]
})
for (const path of files) {
  const content = await read(path)
  const newContent = content.replace(/^---/, "---\\ntags: [" + params.tag + "]")
  await edit(path, content, newContent)
}
return files.length + " notes tagged"
\`\`\`

### User interaction
\`\`\`js
// @name Quick Note
// @description Create a note with a form
const result = await form([
  { name: "title", label: "Title", required: true },
  { name: "body", label: "Content", type: "textarea" },
  { name: "important", label: "Mark as important", type: "boolean" },
])
if (!result) return "Cancelled"
const prefix = result.important === "true" ? "⚠️ " : ""
await create("Notes/" + result.title + ".md", prefix + result.body)
return "Created: " + result.title
\`\`\``
