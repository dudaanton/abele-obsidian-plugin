# Linter

The linter checks your notes against rules you choose — properties at the top, a `created` date,
no first-level heading, one blank line after the properties, rules of your own — and lists what
does not follow them. Much of it can be fixed in one go; the rest opens at the line to fix by
hand.

## Running it

- **Lint current note** checks the note in front.
- **Lint folder…** asks for a folder and checks every note in it.
- **Lint vault** checks every note.
- **Open linter** shows the linter's tab with what the last run found.

A note's or a folder's menu in the file explorer has **Lint this note** or **Lint this folder**,
and with several files selected it offers to lint them together. A run goes through a big vault
a batch at a time, so the app stays usable while it works; **Stop** ends it and keeps what was
found so far.

## The list

The linter's tab says what was checked and how much it found, and lists it **By note** or **By
rule**. Each line shows where in the note it is, what is wrong, and which rule said so, red for an
error and yellow for a warning. With many notes the groups start folded and the list shows fifty
at a time.

- Press a line to open the note at that line, in the tab you were reading in, with the linter's
  tab left where it is.
- The wand on a line fixes that one thing. On a note's heading, the wand fixes everything in that
  note that can be fixed, and the page icon beside it shows first what the fix would change, the
  note before and after side by side.
- **Fix all** fixes every note in the list that can be fixed, after saying how many notes that
  is. What cannot be fixed by itself stays in the list.
- **Again** checks the same notes again.

A fix only rewrites a note that has not changed since it was read: a note you are typing in, or
one that just arrived from another device, is left as it is, and you are told.

## The rules

| Rule | What it checks | What the fix does |
|---|---|---|
| Has properties | The note starts with a properties block. | — |
| Properties can be read | The block is on the first line, closed, readable, no property twice. | Moves a block that slipped down back to the top; takes out a property written twice with the same value. |
| Required properties | The properties you list are filled in; `created` to start with. | Fills in those with a default: `created` gets the day the file was made. |
| Has a note type | The note has a `type`, and one from your list if you give one. | Writes the default type, if you set one. |
| No tags | No `tags` property and no `#tags` in the text. | Takes the property out; tags in the text are for you. |
| Unwanted properties | None of the properties you list is there. | Takes them out. |
| Blank line after the properties | Exactly one blank line between the properties and the text. | Makes it one. |
| No first-level heading | No `#` heading: the file name is the title. | Takes out one that only repeats the name, makes the others `##`. |
| Dates written as dates | Date properties hold a date as 2026-09-27. | Rewrites 2026-9-5, 05.09.2026 and `[[2026-09-05]]`. |

Some start switched off, because most vaults would fail them everywhere: note type, tags,
unwanted properties and dates.

## Setting it up

In **Settings → Abele → Linter**:

- **Folders to skip** — folders no rule looks in, such as your templates.
- Each rule has a switch, and its gear opens where it is set up: an error or a warning; only in
  some folders (or globs like `Projects/*/Tasks`) and not in others; only for some note types;
  only for notes with a property, or a property with a value; and the rule's own settings — the
  list of required properties with their defaults, the allowed types, the properties that are not
  wanted. **As it ships** puts a rule back the way it came.

The linter's settings travel with the others when you [send settings to another
device](transfer).

## Rules of your own

A script can be a rule. Its first lines say `// @lint` (or `// @lint warning`), and it gives back
a `check` that says what is wrong with a note and, if it can, a `fix` that returns the note's new
text. It is listed with the other rules and set up the same way. See [Scripts](scripts#lint-rules)
for how to write one.

The AI agent can use the linter too: asked to tidy your notes, it can check them against the same
rules and apply the fixes, and it asks before it changes anything.
