# Abele

An Obsidian plugin that keeps tasks, journals, logs, finance, time tracking, galleries,
templates and an AI agent in one vault, with as few outside dependencies as possible. This
reference is written for agents working inside a vault that uses it — what the conventions are,
which tool to reach for, and what not to do by hand.

## Notes are the database

Everything is a note. A task is a note, a transaction is a note, a time entry is a note. There
is no separate store and no index file to keep in step: change the note and the feature
changes with it.

Two frontmatter properties carry almost all the meaning:

- `type` — what a note *is*. `task`, `transaction`, `time-entry`, `abele-skill`, `abele-prompt`,
  and whatever types the vault's owner has invented for their own notes.
- `groups` — a list of wikilinks saying what a note *belongs to*. It is the backbone: relations,
  the scope an agent is allowed to touch, and every "show me everything under X" view walk it.

`groups` is a graph, not a folder tree. A note can belong to several groups, and a group can
belong to another group. Walking up from a note reaches everything it is part of; walking down
from a group reaches everything under it, at any depth.

## Reading before writing

Before creating or editing an entity note, read a real one of the same kind from the vault. The
property names below are what the plugin writes, but a vault carries history: older notes may
have extra properties, and hand-written ones may be irregular. Match what is there.

Never invent a property name to mean something the plugin already has a name for — a task with
`deadline` instead of `due` is invisible to every list in the plugin.

## When there is a tool, use the tool

Several kinds of note have a tool or a command that builds them correctly: templates, tasks,
transactions, time entries. Writing the frontmatter by hand is allowed and sometimes right, but
it skips path templates, default folders and the vault's own template notes. Look for the tool
first — see the `tools` and `commands` sections.

## Where the settings live

Settings are one tab in Obsidian's own settings window, split into: Tasks, Logs, Journals,
Finance, Time Tracking, AI Agent, Scripts, Links, Transfer, Other. An agent cannot open them;
when something needs configuring, say which tab it is on and let the person do it.
