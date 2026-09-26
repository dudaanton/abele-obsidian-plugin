# Scripts and automations

Small JavaScript programs kept in your vault, for anything the plugin does not do by itself.

## Turning scripts on

Scripts run inside Obsidian with full access to your vault, so they are off until you turn them on
in **Settings → Abele → Scripts → General** and choose the folder they live in. Only run scripts
you have read or trust.

## A script

A script is a `.js` file in the scripts folder that starts with a header:

```js
// @name Tag untagged notes
// @description Finds notes without tags and adds one
// @icon tag
// @param tag string "Tag to add" = "todo"

const tasks = await find({ property: "type", value: "task" })
log(`Found ${tasks.length} tasks`)
return 'Done'
```

`@param` lines become a form when you run the script yourself (a parameter ending in
`selection` starts out as the words you have selected), and arguments when an agent or
another script calls it. **Create script** starts a new one. **Show script API reference** lists
everything a script can use: notes and search, templates, forms and dialogs, web requests, dates,
and `agent()` to hand the fuzzy part of a job to a model. An AI agent can write scripts for you.

## Running a script

- From the command palette: every script is a command, **Script: <name>**.
- From **Settings → Abele → Scripts → Library**, which lists every script with its description.
- From a button in a note's header, which runs it on that note.
- On words selected in a book, from the bar under the page: see [Books](books).
- From a link, inside or outside Obsidian.
- By an AI agent, which sees your scripts as tools.
- By itself, through an automation.

## Script runs

**Show script runs** lists every run of this session: its status, its log lines, what it returned
or why it failed. A run can be stopped, run again, or run again with changed values. While a
script runs, the status bar says so.

## Header buttons

**Settings → Abele → Scripts → Header buttons** puts buttons above notes that run a script on
that note. A button can show on notes of some types, in some folders, or on every note, and only
when the note's properties match conditions you set. Pick its icon from a grid and choose whether
it shows its name.

## Automations

**Settings → Abele → Scripts → Automations** runs a script by itself when something happens: a task
completed, reopened, created, changed or moved to another date; a note created, changed, renamed
or deleted. A rule can be limited to note types, folders or a property value, and to at most one
run every so many seconds per note.

An automation runs on the device where the change was made. Changes that arrived by sync are
skipped unless the rule says **Also for changes from other devices**. If automations start
setting each other off too often, they pause until you edit one or restart Obsidian.

## Links

**Settings → Abele → Links** gives a script or a command a name, so a link can start it:

```
obsidian://abele?name=add-expense&amount=12
```

The link's extra values reach the script as parameters. Such a link works from a note, a browser,
a shortcut on your phone or another app. **Wait for sync** holds it until Obsidian has finished
syncing after launch.

## Script views

A script can open a tab of its own with cards, buttons, fields, tables and its own HTML: a feed of
notes, flashcards, a dashboard. The tab is saved with your workspace and comes back after a
restart.

## CSS snippets

Choose a snippets folder in **Settings → Abele → Other**. The CSS files in it are loaded, and
reloaded as you edit them. **Create CSS snippet** makes a new one; **Reload CSS snippets** loads
them all again.
