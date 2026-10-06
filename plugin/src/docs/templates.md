# Templates

The plugin has its own template system, used by the note-creating commands and available to
agents and scripts. It replaces tokens in a note and can ask for values as it goes.

## What a template is

An ordinary note kept in the templates folder. Its body is copied, its tokens are filled in,
and the result becomes a new note — or is inserted at the cursor of the one that is open.

Call `template_docs` for the token syntax and the full list. Dates, the note's own name,
prompted variables, wikilinks and images all have their own forms, and guessing at them
produces a note with the token still in it. User templates accept both `{{date:YYYY}}` and
`{{date.format('YYYY')}}` for the current local date; old path/data templates continue to use
`{{date:YYYY}}` with their supplied date. The two contexts need not refer to the same day.

## Commands and device-local confirmation

Two user-template features execute code: `callbacks: "command:<id>;command:<id>"`
runs Obsidian commands (including other plugins' commands), and
`{{plugin-id;method-name;Label}}` calls a plugin method with the field's text. Plugin-method
placeholders can occur in the body, `target_folder`, `target_name` or any `template_for_*`
property. Prompt templates and transaction template bodies use the same method gate.

A template using either feature needs explicit confirmation on each device. It reuses the
script trust records and review dialog, but is always checked: the optional foreign-script
switch, existing files, local edits and agent writes do not approve templates. Approval covers
the complete file text and the indexed execution settings actually used (metadata can lag a
file edit). A changed version waits again. A byte-identical copy can reuse its approval, just
as a renamed script can.

Unconfirmed templates still render ordinary content and create/replace/insert notes. Commands
are skipped; plugin-method fields use the supplied text without calling the method. Agent,
script and automatic calls never wait for a confirmation dialog. A persistent notice, once per
version per session, offers **Review**. Review shows the full template and execution settings,
or changes against the last confirmed version. **Confirm** enables future applications on
this device; it does not replay the skipped work. **Not now** leaves it waiting and keeps the
notice available for later review. Default
templates that need input still retain their existing automatic-input restriction.

Approvals live only in vault-scoped device-local storage, not settings or synced files, and
are excluded from settings transfer. Templates with no commands or plugin calls do not ask.

## Using them

`list_templates` says what the vault has; `apply_template` runs one. From the palette:
**Create note from template**, **Insert template at cursor**, **Replace current note with
template**, **Create note in group**.

Templates are also the foundation the other modules build on: the task, transaction and time
entry notes are all produced this way, and a vault can point those at its own template note
rather than the built-in one.
