import type { AgentTool } from '../client'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScopeResolver } from '../ScopeResolver'
import { normalizePath } from 'obsidian'

const SCRIPT_API_DOCS = `# Script API Reference

Scripts are async JavaScript functions that run with full vault access (no scope restrictions).
All functions below are available as top-level globals — no imports needed.
Scripts have a 60-second timeout. Use \`return\` to output a result string.

---

## Header Format

Every script must start with a comment block declaring its metadata:

\`\`\`js
// @name My Script Name
// @description What the script does
// @param paramName string "Required string parameter"
// @param count number? "Optional number parameter"
// @param dryRun boolean? "Optional flag (shown as toggle in UI)"
\`\`\`

- Parameter types: \`string\`, \`number\`, \`boolean\`
- Add \`?\` after type for optional (e.g. \`number?\`)
- Boolean params are rendered as toggles, not text inputs
- Parameters are available via the \`params\` object (e.g. \`params.paramName\`)

---

## File Operations

All async. Full vault access — no scope restrictions.

| Function | Returns | Description |
|----------|---------|-------------|
| \`read(path)\` | \`string\` | Read file content |
| \`edit(path, oldString, newString)\` | — | Replace first exact match of \`oldString\` with \`newString\` |
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

---

## Network

| Function | Returns | Description |
|----------|---------|-------------|
| \`fetch(url, opts?)\` | \`{ status, headers, data, text }\` | HTTP request |
| \`downloadImage(url, filename?)\` | \`string\` | Download image to vault, returns saved path |
| \`downloadFile(url, filename?, ext?)\` | \`string\` | Download any file to vault, returns saved path |

\`fetch\` options: \`{ method?, headers?, body? }\`
Secret substitution: use \`\${abele_key:name}\` in url, headers, or body to inject secrets configured in AI settings.

---

## AI

| Function | Returns | Description |
|----------|---------|-------------|
| \`agent(task, opts?)\` | \`string\` | Delegate task to an AI sub-agent |
| \`generateImage(prompt)\` | \`string\` | Generate image from text, returns vault path |

\`agent\` options: \`{ model?: string }\`
- Preset slots: \`"primary"\`, \`"delegate"\`, \`"wise"\`
- Or pass any model ID from your configured models (e.g. \`"gpt-4o"\`, \`"claude-sonnet-4-20250514"\`)
- Default: \`"delegate"\`

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
| \`setStatus(text)\` | — | Set status bar text (auto-cleared when script ends) |
| \`form(fields)\` | \`object \\| null\` | Show form modal (command palette only) |

\`form\` fields: \`[{ name, label, type?, options?, default?, required? }]\`
Types: \`"text"\` (default), \`"textarea"\`, \`"select"\`, \`"boolean"\`

---

## Globals

| Name | Type | Description |
|------|------|-------------|
| \`params\` | \`object\` | Resolved parameter values from the script header |
| \`signal\` | \`AbortSignal\` | Cancellation signal — check \`signal.aborted\` in long loops |
| \`log(...args)\` | — | Append to script output. Objects are JSON-stringified |

\`log()\` output is captured and returned as the script result.
You can also \`return "result"\` directly.

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

export function createScriptApiDocsTool(): AgentTool {
  return {
    name: 'script_api_docs',
    label: 'Script API Docs',
    description:
      'Get the full API reference for writing Abele scripts. Call this before create_script to see all available functions.',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({
      content: [{ type: 'text', text: SCRIPT_API_DOCS }],
    }),
  }
}

export function createCreateScriptTool(): AgentTool {
  return {
    name: 'create_script',
    label: 'Create Script',
    description:
      'Create a new JavaScript script in the scripts folder. Use script_api_docs first to get the full API reference for writing scripts.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Script file name (without .js extension)' },
        content: { type: 'string', description: 'Full script content including header comments' },
      },
      required: ['name', 'content'],
    },
    execute: async (_id, params) => {
      const name = params.name as string
      const content = params.content as string
      if (!name) throw new Error('Missing required parameter: name')
      if (!content) throw new Error('Missing required parameter: content')

      const config = AbeleConfig.getInstance().ai
      if (!config.scriptsEnabled || !config.scriptsFolder) {
        throw new Error('Scripts are not enabled or scripts folder is not configured.')
      }

      const path = normalizePath(`${config.scriptsFolder}/${name}.js`)
      const { app } = GlobalStore.getInstance()

      // Ensure folder exists
      const folderPath = path.substring(0, path.lastIndexOf('/'))
      if (folderPath && !app.vault.getAbstractFileByPath(folderPath)) {
        await app.vault.createFolder(folderPath)
      }

      const existing = app.vault.getAbstractFileByPath(path)
      if (existing) {
        throw new Error(`Script already exists: ${path}. Use edit tool to modify it.`)
      }

      await app.vault.create(path, content)
      ScopeResolver.getInstance().addFile(path)

      return {
        content: [
          {
            type: 'text',
            text: `Script created: ${path}. It will be available as a command after auto-discovery.`,
          },
        ],
        details: { diff: { old: '', new: content } },
      }
    },
  }
}
