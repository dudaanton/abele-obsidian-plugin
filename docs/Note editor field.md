# Note editor field

A field that is Obsidian's own note editor: live preview, `[[` offering notes, the formatting
commands, undo, and on a phone Obsidian's toolbar above the keyboard. What it holds is the
markdown written in it.

Scripts, and so agents, put it in front of a person two ways:

- `form()` — a field with `type: "note"`. Its answer is the markdown. Mod+Enter runs the form;
  Enter is a new line, as in a note. From a chat, where nobody sees the form, the agent answers
  it with `answer_form` like any other field.
- a view — `new NoteInput({ value, placeholder, onInput, onChange, onEnter })`. `value` is
  reactive both ways; `input` fires as it changes, `change` when it loses focus, `enter` on
  Mod+Enter.

The component is `src/components/NoteEditorField.vue`; the editor inside it is
`src/editor/embeddedEditor.ts`.

## The borrowed editor

Obsidian gives plugins no note editor to put in their own windows. The field borrows the one
Obsidian writes notes with, the way the Kanban plugin and many others do: Obsidian is asked
for the editor of an embedded note, and its class is taken from there. That is Obsidian's
insides and can change with any update, so:

- if the editor cannot be found, the field is a plain text box;
- `tests/e2e/noteField.e2e.test.ts` asks for the editor first thing and fails when it is gone.

The editor in a field has no file behind it. The plugin's own additions to the note editor —
the task header, galleries, footnotes, comment markers — each look the file up and draw
nothing without one. A link in the text is written relative to the vault's root, and a tap on
it puts the cursor there instead of opening the note behind the dialog.

## The phone's toolbar

Obsidian shows its toolbar above the keyboard while `app.workspace.activeEditor.editor` has
the focus, and nothing else decides it; its buttons run the editor commands against that same
`activeEditor`. The borrowed editor sets itself there when it takes the focus. Obsidian clears
it whenever a leaf becomes active, so the field claims it back on `active-leaf-change` and
when the keyboard comes up, for as long as it keeps the focus. The toolbar lives in the app
container at the menu layer, above a dialog's.

Under `emulateMobile` the toolbar comes up for the field in a dialog, over the dialog, and
the e2e tier checks both. What an iPhone does with it is not something the emulator can show.
