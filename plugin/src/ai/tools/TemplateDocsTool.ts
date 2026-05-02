import type { AgentTool } from '../client'

const TEMPLATE_DOCS = `# Abele Templates Reference

Templates are vault notes with special frontmatter that define reusable note structures. When applied, a template creates a new note with the template content, resolved variables, and configured properties.

## Creating a Template

Any vault note becomes a template when its frontmatter includes:

\`\`\`yaml
---
type: template
template_for: place         # required — category/type of notes this template creates
template_dir: Travel        # optional — folder grouping in template picker UI
order: 1                    # optional — sort order in UI
target_folder: "Places/{{ country }}"  # optional — where the new note is created
target_name: "{{ title }}"  # optional — filename for the new note
callbacks: "command:app:reload"  # optional — Obsidian commands to run after creation (;-separated)
template_for_created: "{{ date }}"    # optional — sets "created" property on the new note
template_for_category: "{{ type }}"   # optional — sets "category" property on the new note
---

Note content goes here with {{ variables }}.
\`\`\`

When the template is applied:
- \`type: template\` is replaced with \`type: <template_for value>\` in the new note
- All \`template_for_*\` properties become regular properties (e.g., \`template_for_created\` → \`created\`)
- Template-specific properties (\`template_dir\`, \`order\`, \`callbacks\`, \`target_folder\`, \`target_name\`) are stripped
- Remaining frontmatter properties are preserved as-is

## Variables

Use \`{{ variable_name }}\` syntax in template content, target_folder, target_name, and template_for_* values.

### User variables (require input)

\`\`\`
{{ title }}           → prompts user for "title" value
{{ description }}     → prompts user for "description" value
\`\`\`

### Date variables (auto-resolved)

\`\`\`
{{ date }}                              → current date (YYYY-MM-DD)
{{ date.format('MMMM D, YYYY') }}      → custom format (e.g., "April 28, 2026")
{{ date.offset(-7) }}                   → 7 days ago
{{ date.offset(30).format('MM/DD') }}   → 30 days from now, custom format
\`\`\`

### List variables

\`\`\`
{{ tags::list }}        → user provides array → rendered as YAML list:
                          - tag1
                          - tag2

{{ links::wiki_list }}  → user provides array → rendered as wikilink list:
                          - "[[item1]]"
                          - "[[item2]]"
\`\`\`

When using the apply_template tool, pass list variables as JSON arrays:
\`{ "tags": ["tag1", "tag2"], "links": ["Page A", "Page B"] }\`

### Wikilink variable

\`\`\`
{{ project::wikilink }}   → file picker, resolved as "[[path/to/file|file]]"
\`\`\`

The value is always quoted and uses \`|alias\` format with the filename. The \`.md\` extension is stripped automatically.
Examples: \`"[[Projects/Main|Main]]"\`, \`"[[note|note]]"\`

When using the apply_template tool, pass the file path as a string:
\`{ "project": "Projects/Main" }\` or \`{ "project": "Projects/Main.md" }\`

### Image variable

\`\`\`
{{ cover::image }}   → image picker (vault / disk / clipboard), resolved as attachment path
\`\`\`

The selected or pasted image is imported into the vault attachment folder. The variable is replaced with the resulting vault path.

When using the apply_template tool, pass the vault path as a string:
\`{ "cover": "Attachments/cover.jpg" }\`

### Select variable

\`\`\`
{{ status::select(Draft,Active,Done) }}   → dropdown with the given options
\`\`\`

When using the apply_template tool, pass one of the listed options:
\`{ "status": "Draft" }\`

### Default values

Any variable (except date and plugin) supports a default via \`::default(...)\`:

\`\`\`
{{ title::default(Untitled) }}
{{ project::wikilink::default(Projects/Main.md) }}
{{ status::select(Draft,Active,Done)::default(Draft) }}
{{ tags::list::default(tag1,tag2) }}
{{ links::wiki_list::default(fileA.md,fileB.md) }}
\`\`\`

Defaults pre-fill the form but can be overridden by the user.
Use \`\\(\` \`\\)\` \`\\,\` to escape literal parentheses and commas inside default values.

### Plugin variables

\`\`\`
{{ pluginId;methodName;Label }}
\`\`\`
Calls \`plugin.methodName(userInput)\` and uses the return value.

## Special template_for Values

- \`template_for: default\` — applied automatically to new notes (the "default template"). Only one should exist.

## Frontmatter Property Reference

| Property | Required | Description |
|---|---|---|
| \`type: template\` | yes | Marks the note as a template |
| \`template_for\` | yes | Category of notes this creates (e.g., "place", "book", "task") |
| \`template_dir\` | no | Folder grouping in the template picker UI |
| \`order\` | no | Sort order within the group |
| \`target_folder\` | no | Vault folder for created note (supports variables) |
| \`target_name\` | no | Filename for created note (supports variables) |
| \`callbacks\` | no | Obsidian command IDs to run after creation, semicolon-separated |
| \`template_for_*\` | no | Properties to set on the created note (prefix stripped) |

## Example Template

A "Book" template at \`Templates/Book.md\`:

\`\`\`yaml
---
type: template
template_for: book
template_dir: Media
target_folder: Books
target_name: "{{ title }}"
template_for_created: "{{ date }}"
template_for_author: "{{ author::wikilink }}"
template_for_status: "{{ status::select(To Read,Reading,Finished)::default(To Read) }}"
template_for_rating: ""
template_for_tags: "{{ tags::list::default(book,fiction) }}"
---

## Summary

{{ summary }}

## Notes

\`\`\`

Using \`apply_template\` with \`{ "title": "Dune", "author": "Frank Herbert", "summary": "Sci-fi epic...", "status": "Reading", "tags": ["book", "sci-fi"] }\` creates \`Books/Dune.md\`:

\`\`\`yaml
---
type: book
created: 2026-04-28
author: "[[Frank Herbert|Frank Herbert]]"
status: Reading
rating: ""
tags:
  - book
  - sci-fi
---

## Summary

Sci-fi epic...

## Notes

\`\`\`
`

export function createTemplateDocsTool(): AgentTool {
  return {
    name: 'template_docs',
    label: 'Template Docs',
    description:
      'Get the reference for creating and using Abele templates. Call this before creating template notes or when you need to understand template syntax, variables, and frontmatter properties.',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({
      content: [{ type: 'text', text: TEMPLATE_DOCS }],
    }),
  }
}
