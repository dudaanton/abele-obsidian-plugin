# Templates

Abele's own templates: notes with placeholders that ask for values as they fill in.

## A template

A template is an ordinary note with `type: template` and `template_for` naming the kind of note it
makes:

```yaml
---
type: template
template_for: place
target_folder: "Places/{{ date.format('YYYY') }}"
target_name: "{{ name }}"
---
# {{ name }}

Visited: {{ date }}
```

`target_folder` and `target_name` say where the new note goes. `template_dir` sorts templates
into folders in the picker, and `order` sorts them within one.

## Placeholders

| Placeholder | What it becomes |
|---|---|
| `{{ date }}` | Today, as `YYYY-MM-DD` |
| `{{ date.format('DD.MM.YYYY') }}`, `{{ date.offset(7) }}` | Another format, another day |
| `{{ title }}`, any other name | A text field you fill in |
| `{{ project::wikilink }}` | A note picker |
| `{{ cover::image }}` | An image from the vault, a file or the clipboard |
| `{{ status::select(Draft,Done) }}` | A drop-down |
| `{{ tags::list }}`, `{{ links::wiki_list }}` | A list of words, or of notes |
| `{{ title::default(Untitled) }}` | Any field with a starting value |

With text selected when you run a template, the selection fills the first field.

## Properties of the new note

A property named `template_for_<name>` in the template becomes `<name>` on the new note, with its
placeholders filled: `template_for_created: "{{ date }}"` gives the note a `created` date.
The note's `type` is taken from `template_for`.

## Commands

- **Create note from template**: pick a template, fill in its fields, get a new note.
- **Insert template at cursor**: the template's text goes into the note you are in.
- **Replace current note with template**: the note you are in becomes the template's result.
- **Create note in group**: a new note that already belongs to the current one.

`callbacks: "command:<id>;command:<id>"` in a template runs those commands after the note is made.

## The default template

A template with `template_for: default` is applied to every new empty note, a second after it is
created, so a note another tool is still filling is left alone. Notes in `attachments/`,
`templates/` and journal folders are skipped.

## Templates everywhere

Tasks, transactions, time entries, journal notes and book highlight notes are all made through
templates. Transactions, journals and book highlights can each use a template note of your own,
chosen in the settings.

The full reference, with every placeholder and example templates, is on
[GitHub](https://github.com/dudaanton/abele-obsidian-plugin/blob/master/docs/Templates.md).
