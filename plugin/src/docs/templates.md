# Templates

The plugin has its own template system, used by the note-creating commands and available to
agents and scripts. It replaces tokens in a note and can ask for values as it goes.

## What a template is

An ordinary note kept in the templates folder. Its body is copied, its tokens are filled in,
and the result becomes a new note — or is inserted at the cursor of the one that is open.

Call `template_docs` for the token syntax and the full list. Dates, the note's own name,
prompted variables, wikilinks and images all have their own forms, and guessing at them
produces a note with the token still in it.

## Using them

`list_templates` says what the vault has; `apply_template` runs one. From the palette:
**Create note from template**, **Insert template at cursor**, **Replace current note with
template**, **Create note in group**.

Templates are also the foundation the other modules build on: the task, transaction and time
entry notes are all produced this way, and a vault can point those at its own template note
rather than the built-in one.
