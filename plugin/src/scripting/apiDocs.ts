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
\`\`\`

- \`@icon\`: Lucide icon name for toolbar display (e.g. \`scroll-text\`, \`sparkles\`, \`wand\`). Defaults to \`scroll-text\` if omitted. See https://lucide.dev for available icons.
- Parameter types: \`string\`, \`number\`, \`boolean\`, \`text\`
- Add \`?\` after type for optional (e.g. \`number?\`)
- Boolean params are rendered as toggles, not text inputs
- Default values: add \`= value\` after description. Use quotes for strings with spaces: \`= "my value"\`
- Defaults pre-fill the form UI and are used as fallback when the param is not provided (e.g. via link URL)
- Add \`selection\` after description/default to auto-fill from editor selection: \`// @param text string "Input text" selection\`
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
| \`create(path, content)\` | — | Create new file (parent folders created automatically) |
| \`remove(path)\` | — | Move file to trash |
| \`move(from, to)\` | — | Move or rename a file |
| \`copy(from, to)\` | — | Copy a file |
| \`ls(path?)\` | \`string[]\` | List folder contents (file/folder paths). Omit path for vault root |
| \`find(opts)\` | \`string[]\` | Search files (see below) |
| \`replace(path, actions)\` | \`string\` | Apply replacement actions to a file (see below) |
| \`open(path)\` | — | Open a file in the Obsidian editor |
| \`setCover(notePath, mediaPath?)\` | — | Set cover image for a note. If mediaPath omitted, uses first media embed in note. Handles video thumbnails automatically |

### find(opts)

Supports both simple shorthand and advanced criteria:

**Shorthand** (fields are AND-combined):
\`\`\`js
await find({ name: "daily" })                        // name contains "daily"
await find({ property: "type", value: "task" })      // property equals value
await find({ content: "TODO" })                      // body contains "TODO"
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

\`fetch\` options: \`{ method?, headers?, body? }\`
\`downloadFile\` options: \`{ filename?, extension?, method?, headers?, body? }\` — supports POST for APIs that return binary (e.g. TTS).
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
| \`form(fields)\` | \`object \\| null\` | Show form modal (command palette only) |
| \`show(markdown, title?)\` | — | Show rendered markdown to read (command palette only) |

\`form\` fields: \`[{ name, label, type?, options?, default?, required?, text? }]\`
Types: \`"text"\` (default), \`"textarea"\`, \`"select"\`, \`"boolean"\`, \`"markdown"\`

A \`"markdown"\` field asks for nothing: it renders \`text\` as markdown for the person to read
and select, and returns no value. Use it to explain a form, or to put a result beside the
questions. \`show(markdown, title?)\` is the same block on its own — prefer it over
\`notice\` for anything long: a notice is truncated, disappears, and cannot be selected.

---

## Globals

| Name | Type | Description |
|------|------|-------------|
| \`params\` | \`object\` | Resolved parameter values from the script header |
| \`signal\` | \`AbortSignal\` | Cancellation signal — check \`signal.aborted\` in long loops |
| \`dayjs\` | \`function\` | [Day.js](https://day.js.org) date library — \`dayjs()\`, \`dayjs('2026-01-01').add(7, 'day')\`, \`.format('YYYY-MM-DD')\`, etc. |
| \`log(...args)\` | — | Append to script output. Objects are JSON-stringified |

\`log()\` output is captured and returned as the script result.
You can also \`return "result"\` directly.

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
