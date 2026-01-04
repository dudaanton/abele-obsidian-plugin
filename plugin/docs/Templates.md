# Custom Templates

Templates allow you to quickly create notes with predefined structure, variables, and automation.

## Creating a Template

A template is a regular markdown file with special frontmatter properties:

```yaml
---
type: template
template_for: place
template_dir: "Travel/Places"
order: 1
target_folder: "Places/{{ date.format('YYYY') }}"
target_name: "{{ name }}"
---

# {{ name }}

Visited: {{ date }}
```

### Required Properties

| Property | Description |
|----------|-------------|
| `type` | Must be `"template"` |
| `template_for` | Note type: `place`, `book`, `default`, etc. Used for grouping |

### Optional Properties

| Property | Description |
|----------|-------------|
| `template_dir` | Hierarchy path in selection modal: `"Dir1/Dir2"` |
| `order` | Sort order (lower = higher in list) |
| `target_folder` | Destination folder for new note (supports variables) |
| `target_name` | File name without extension (supports variables) |
| `callbacks` | Commands to execute after creation: `"command:id1;command:id2"` |
| `template_for_*` | Properties to set on target note (see below) |

## Variables

Variables use `{{ }}` syntax and work in template body, `target_folder`, and `target_name`.

### Date Variables

| Syntax | Result |
|--------|--------|
| `{{ date }}` | Current date (`YYYY-MM-DD`) |
| `{{ date.format('DD.MM.YYYY') }}` | Custom format |
| `{{ date.offset(7) }}` | Date + 7 days |
| `{{ date.offset(-1).format('MMM D') }}` | Yesterday with custom format |

### User Variables

Any other `{{ variable_name }}` becomes a text input field in the modal:

```markdown
# {{ title }}

Author: {{ author }}
Rating: {{ rating }}
```

This template prompts for three inputs: title, author, rating.

### Plugin Method Calls

```
{{ plugin_id;method_name;Label text }}
```

Calls `app.plugins.plugins[plugin_id][method_name](userInput)` and inserts the result.

## Target Note Properties

Use `template_for_*` properties to set frontmatter on the created note. This is useful when Obsidian's property type system prevents you from using variables directly (e.g., date fields).

```yaml
---
type: template
template_for: note
template_for_created: "{{ date }}"
template_for_status: draft
template_for_tags: "idea, {{ category }}"
---

# {{ title }}
```

When this template is applied, the resulting note will have:

```yaml
---
type: note
created: 2026-01-03
status: draft
tags: "idea, science"
---

# My Note Title
```

The `template_for_` prefix is stripped, and variables are resolved.

## Commands

### Create Note from Template

1. Opens template selection modal (grouped by `template_dir`)
2. Prompts for variables (if any)
3. Creates file at `target_folder/target_name.md` (or Obsidian default location)
4. Executes `callbacks` sequentially

### Replace Current Note with Template

Replaces entire content of active file. Ignores `target_folder` and `target_name`.

### Insert Template at Cursor

Inserts template content at cursor position. Ignores `target_folder` and `target_name`.

## Selection Autofill

When text is selected before invoking a template:

- **1 variable**: Auto-filled, no prompt shown
- **Multiple variables**: First variable auto-filled, prompt shown for the rest

## Default Template

A template with `template_for: default` automatically applies to new empty files.

```yaml
---
type: template
template_for: default
---

Created: {{ date }}
```

**Conditions:**
- File must be empty
- File path not in excluded folders (configurable in settings)

## Callbacks

Execute commands after note creation:

```yaml
callbacks: "command:daily-notes:create;command:templater:insert"
```

Format: `command:<command-id>` separated by `;`

Commands run sequentially via `app.commands.executeCommandById()`.

## Settings

| Setting | Description |
|---------|-------------|
| `excludedPathsForDefaultTemplate` | Folders where default template won't apply (e.g., `attachments/`, `templates/`) |

## Examples

### Book Note

```yaml
---
type: template
template_for: book
template_dir: "Reading"
order: 1
target_folder: "Books"
target_name: "{{ title }}"
---

# {{ title }}

Author: {{ author }}
Started: {{ date }}
Status: #reading

## Notes

```

### Daily Note

```yaml
---
type: template
template_for: daily
target_folder: "Journal/{{ date.format('YYYY/MM') }}"
target_name: "{{ date }}"
---

# {{ date.format('dddd, MMMM D') }}

## Tasks

- [ ] 

## Notes

```

### Meeting Note with Callback

```yaml
---
type: template
template_for: meeting
template_dir: "Work/Meetings"
callbacks: "command:calendar:insert-event"
---

# {{ topic }}

Date: {{ date }}
Attendees: {{ attendees }}

## Agenda

## Action Items

- [ ] 
```
