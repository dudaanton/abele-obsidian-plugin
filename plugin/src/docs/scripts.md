# Scripts

Scripts are JavaScript files in the vault's scripts folder that run inside Obsidian with full
vault access. They are how a person automates something too specific for a feature, and how an
agent leaves behind something repeatable instead of doing the same work again next week.

## The header

Every script starts with a comment block declaring what it is. Without `@name` the file is
ignored.

```
// @name Tag untagged notes
// @description Finds notes without tags and adds one
// @icon tag
// @param tag string "Tag to add" = "todo"
```

A script with parameters asks for them in a form when a person runs it, and takes them as
arguments when an agent or another script calls it.

## Writing one

Call `script_api_docs` before writing a script. It is the full reference for what is in scope —
file operations, `find`, templates, `agent`, `fetch`, forms, `show` — and none of it is
guessable. A script is an async body: `return` a string and that is its result; `log()` as it
goes and those lines are its output.

Where a script asks a person for something longer than a word — a description, an entry, a
list — the field can be Obsidian's own note editor rather than a text box: `type: "note"` in a
`form()`, `NoteInput` in a view. Links with `[[`, formatting and checklists work in it, and on a
phone Obsidian's toolbar stands above the keyboard while it is typed in, as in a note. What it
gives back is the markdown written in it.

Where the answer is one of the person's notes — a wallet, a person, a project — the field is a
note picker: `type: "note-picker"` in a `form()`, `NotePicker` in a view. It searches as the
quick switcher does, only among the notes its `filter` lets through, written in `find()`'s words
(`{ property: "type", value: "account" }` for the finance wallets). It gives back a path, or a
wikilink with `returns: "link"`, and a list with `multiple`; `create` lets the person make the
note they were looking for when it is not there yet.

## Running one

Six ways in: the command palette, a button in a note's header, an `abele://` link, an
agent calling the `script_<name>` tool, an automation when something happens to a note, or the
book reader's bar on selected words, which gets the words, their sentence and a link to their
place as `book`. What that bar offers first is the book menu: the scripts the person chose in
Settings → Books (`reader.selectionScripts`) or pinned from its script list, then those
whose header has `// @book`. Up to three are a button each, more fold into one menu, and any other
script is picked from the list. A script can call another with `runScript`.

The toolbar is the same idea for notes. A script whose header has `// @toolbar`, or which the
person pinned from the script library (`ai.toolbarScripts`, by name), is a button with its icon
among the icons at the top right of every note on a computer — pressed, it runs on that note and
whatever is selected in it, as from the command palette — and is put at the start of the phone's
toolbar above the keyboard, Obsidian's own `mobileToolbarCommands`. That list belongs to the person
as much as to the plugin: only what the plugin put there is taken off again, and a script the
person took off by hand is not put back unless it is pinned again. Every script is a command
(`Script: <name>`) whether or not it is on the toolbar, so it can have a hotkey and be put on the
phone's toolbar by hand too.

A script can also run each time the plugin starts — Obsidian opening, and also the plugin being
reloaded or updated, which is the same start from where the plugin stands; switching scripts on
later in a session runs nothing. Those are the scripts on the startup list (`ai.startupScripts`,
each `{ script, devices }` with `devices` one of `both`, `desktop`, `mobile`), in its order, then
those whose header has `// @startup` (or `// @startup desktop`, `// @startup mobile`), by name.
They start once the workspace is laid out, the script index is read and Obsidian has read the
notes, and run one after another. A script's parameters are its defaults: one that needs a value
with no default is skipped with a notice, and a `form()` inside a startup script is answered as
if dismissed (`null`). One that throws is a failed run and a console warning naming it; one still
running after 30 seconds is named in a warning and the next starts while it goes on in the
background. `ai.startupScriptsPaused` skips them all. The script running at startup is also kept
on the device while it runs, so one that froze the app is skipped, once, at the next start, with a
notice. Runs started this way are listed as `startup` in the list of runs.

The **Scripts** page of the plugin's settings lists every script as a card — its `@icon`,
`@name`, `@description` and parameters, straight from the header above — and runs one,
makes a header button for it, pins it to the toolbar, or puts it on the startup list from there
(its **Startup** tab orders that list and holds the switch that skips it). That header is therefore also how a script presents
itself to the person: a script without `@description` shows up saying it has none.

## Automations

A script can also run by itself when something happens to a note. The **Automations** tab of
the Scripts page holds the rules: when (a task completed, reopened, created, changed or given
another date; a note created, changed, renamed or deleted), on which notes (note types — task
events are about tasks already — folders, one frontmatter property equal to a value), which
script with which parameter values, and at most how often for one note. The parameters are
templates like a header button's: `{{title}}`, `{{path}}`, `{{event}}` and the note's
frontmatter fields. A finance transaction being created is a note of type `transaction` being
created.

The script finds what happened in `event` — the kind, the note's path, its frontmatter before
and after, which properties changed; `script_api_docs` has the whole shape. A run started this
way is listed under **Show script runs** with the event beside it, and a failure is a failed
run there plus one notice, never an error thrown at the person.

What keeps them from running away: a script's own writes never set off the automation that
ran it; one automation's write setting off another stops after three in a row; changes to one
note within the interval are gathered into one run at its end; and more than 30 runs in a
minute pause every automation until one of them is edited or Obsidian restarts. They do not
run while the settings file could not be read.

An automation runs on the device where the change was made. A change that arrives by sync —
or from another app, or while Obsidian was closed — runs nothing, because the device where it
was made has run it already; a rule can opt in to those with **Also for changes from other
devices**. The difference is told by how the file changed: a write made here goes through
Obsidian's vault, and one that arrives does not.

## Watching one

Every run of this session is listed under **Show script runs**: its status, when it started,
how long it took, each `log()` line with the time it was printed, and what it returned or how
it failed. From there a run can be stopped, run again with the same values, or run as new with
the values open to change. Nothing about a run is written to the vault, and the list is gone
when Obsidian closes.

While a script is running the status bar says so; clicking it opens the list.

## Views

A script can open a tab of its own and fill it with components — cards, buttons, inputs,
markdown, tables, its own HTML and CSS — and its handlers keep running after the script has
returned. This is the shape for anything a person will look at and press, rather than read
once: a feed of notes, flashcards, a dashboard that refreshes as the vault changes. `show()`
is for a result; a view is for an interface. The reference is `script_api_docs` with
`section: 'views'`. `inspect_view` with `view: '<title>'` reads the view back as the tree the
script built; `screenshot` with the same `view` takes a picture of the part of it that is on
screen right now — only that part, and only while the tab is showing.

A view's tab is saved with the workspace: after a restart the plugin runs the script again
with the same parameters and the state the view had, so a script that keeps its place keeps
it across a restart too.
