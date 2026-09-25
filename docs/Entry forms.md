# Entry forms

The task and transaction dialogs. The plugin's own add and edit buttons open them — the add
icons in the task list, the timeline and the finance sidebar, a day's menu in the calendar, a
transaction note's *Add next*, the *Create new task* and *Create new transaction* commands, and
a click on a task card or a transaction row. Ctrl/Cmd-click on a card or row, and *Open note*
in its menu, still open the note itself.

Nothing about the notes changed. A task is a note with `type: task`, a transaction a note with
`type: transaction`, and one written by hand is exactly as good as one written by a dialog.

## The task dialog

Title, date and time, due date and time, repeat, and the description. The dates open the same
date dialog the task header uses, the repeat the same repeat dialog. The description is
Obsidian's own note editor: live preview, `[[` offering notes, the formatting commands, undo.

## The transaction dialog

- **Amount** takes a sum — `3.50 + 2×1.20` — worked out as it is typed and written as its answer.
  The keys under it put in the operators a phone's number pad does not have.
- **From** and **To** offer the accounts as a name is typed, wallets first on the side money
  leaves, spending accounts first on the side it arrives. Under a wallet stands its balance on
  the transaction's day and, for a new transaction, what it will be after it.
- **Currencies** are read off the accounts, the same way a new transaction note always got
  them. When the two accounts are in different currencies the dialog adds the second amount
  and the rate; editing either works the other out. A new pair starts from the rate last used
  between those currencies in the vault. Nothing is fetched from the internet.
- **Category** offers the notes in the categories folder, **Groups** is Obsidian's own list
  field, and the description is the note editor, as in the task dialog.
- **Next** saves and starts another transaction on the same day between the same accounts,
  keeping the groups — a receipt of several lines, one after another.

## Saving

A new task or transaction is written by the same code the old buttons used: the same folder,
the same name template, the same currencies. Saving an existing one rewrites its text and the
properties the dialog shows, and leaves every other property as it found it. *Open as note*
saves first, then opens the note.

A new transaction written from the dialog has its title and description, so the transaction
template, which fills in a note that has neither, is not applied to it.

## The borrowed editor

Obsidian gives plugins no note editor to put in their own windows. The dialogs borrow the one
Obsidian writes notes with, the way the Kanban plugin and many others do: Obsidian is asked for
the editor of an embedded note, and its class is taken from there (`src/editor/embeddedEditor.ts`).
That is Obsidian's insides and can change with any update, so:

- if the editor cannot be found, the buttons do what they did before the dialogs existed —
  create the note and open it, or open the existing one;
- `tests/e2e/entryForms.e2e.test.ts` asks for the editor first thing and fails when it is gone.

The editor in a dialog has no file behind it. The plugin's own additions to the note editor —
the task header, galleries, footnotes, comment markers — each look the file up and draw nothing
without one. A link in the text is placed relative to the vault's root, and a tap on it puts
the cursor there instead of opening the note behind the dialog.

**Groups** uses Obsidian's own list property field, which is borrowed the same way; without it
the field is plain text, values separated by commas.

## Phone

Both dialogs are the kit's tall modal, which on a phone is Obsidian's own bottom sheet. The
fields scroll; the buttons stay at the bottom. Both are in `tests/e2e/phoneLayout.e2e.test.ts`
and `tests/e2e/dialogRings.e2e.test.ts`. What the iPhone keyboard does to them cannot be seen in
the emulator.
