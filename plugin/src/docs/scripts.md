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

## Running one

Four ways in: the command palette, a button in a note's header, an `abele://` link, or an
agent calling the `script_<name>` tool. A script can call another with `runScript`.

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
