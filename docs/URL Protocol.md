# URL Protocol

Abele registers custom URL protocol `obsidian://abele` for external integrations. This allows other applications, scripts, or browser extensions to interact with your vault.

## General Format

```
obsidian://abele?action=<action>&param1=value1&param2=value2
```

All parameter values must be URL-encoded.

## Sync Handling

All protocol actions wait for Obsidian Sync to complete before executing. This ensures data consistency when vault is syncing after app launch.

---

## Actions

### Append/Replace Note Content

Adds or replaces content in a note.

#### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `data` | Yes | Content to add (URL-encoded) |
| `daily` | No* | If present, targets today's daily note |
| `journal` | No* | Journal name (required with `daily`) |
| `path` | No* | Path to target note (required without `daily`) |
| `mode` | No | `append` (default) or `replace` |

\* Either `daily` + `journal` or `path` must be provided.

#### Daily Note Mode

Targets today's note from a specific journal. The journal must have `recurrence: daily`.

If the daily note doesn't exist, it will be created using the journal's template.

```
obsidian://abele?daily&journal=Daily&data=Hello%20World
```

#### Path Mode

Targets a specific note by path. The file must already exist.

```
obsidian://abele?path=Notes/inbox&data=New%20item
```

#### Examples

**Append text to daily note:**
```
obsidian://abele?daily&journal=Daily&data=-%20Task%20from%20external%20app
```

**Replace content in a note:**
```
obsidian://abele?path=Scratch/temp&data=Fresh%20content&mode=replace
```

**Add multiline content:**
```
obsidian://abele?daily&journal=Daily&data=%23%23%20Meeting%20Notes%0A%0A-%20Point%201%0A-%20Point%202
```

Decoded `data`:
```markdown
## Meeting Notes

- Point 1
- Point 2
```

#### Behavior

- **Append mode**: Adds content at the end of the file with a preceding newline
- **Replace mode**: Replaces entire file content (including frontmatter)

#### Errors

Errors are displayed as Obsidian notices:

- `Missing required parameter: data`
- `Parameter "journal" is required when "daily" is specified`
- `Journal "<name>" not found`
- `Journal "<name>" is not a daily journal`
- `Either "daily" or "path" parameter is required`
- `File not found: <path>`
- `Failed to create daily note`

