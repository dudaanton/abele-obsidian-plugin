# Getting started

What Abele is, the two ideas everything else rests on, and where to begin.

## What Abele is

Abele is one plugin for the things a personal vault usually needs a dozen plugins for: tasks,
journals and a calendar, logs that gather everything written about a note, finances, time
tracking, templates, image galleries, charts and maps, a book reader, GitHub in tabs, AI agents
and scripts. It works on the desktop, on phones and on tablets.

It depends on no other plugin. Everything it knows, it reads from your notes.

## Notes are the database

Every record is an ordinary note. A task is a note, a transaction is a note, a time entry is a
note. There is no hidden database: edit the note by hand and the plugin sees the change at once.

Two properties carry most of the meaning:

- `type` says what a note is: `task`, `transaction`, `time-entry`, or any type of your own —
  `person`, `book`, `project`.
- `groups` says what a note belongs to: a list of links, such as `groups: ["[[Garden]]"]`.

Read [Groups and the note footer](groups) next. It is the one idea to understand before the rest.

## Where to begin

1. Open **Settings → Abele → Journals** and add a daily journal, so you have somewhere to write.
   Run **Open today's daily note** from the command palette.
2. Write about your day there, and link the notes it is about. See
   [Logs and journals](logs-and-journals).
3. Run **Create new task**, give it a date, and open the timeline sidebar from the ribbon. See
   [Tasks](tasks).
4. When you want an AI agent, turn it on in **Settings → Abele → AI Agent**. See
   [AI chat and agents](ai-chat).

Every command is in the command palette, prefixed with **Abele:**.

## The sidebars

Abele adds several panels. Each one opens from the ribbon or from a command:

- **Show timeline sidebar**: the calendar with your daily notes, and tasks by date.
- **Show todo sidebar**: tasks without a date.
- **Show finance sidebar** and **Show accounts sidebar**: totals, debts and balances.
- **Show time tracking sidebar**: the running timer and your time entries.
- **Show AI chat sidebar**: chats with your agents.
- **Show script runs**: what your scripts did this session.

On a phone the panels open as drawers. **Settings → Abele → Other** can make them take the full
width of a phone or half of a tablet.

## This documentation

Run **Open documentation** from the command palette, or press **Documentation** at the top
of Abele's settings. The search box finds a word anywhere in these pages.

This documentation is for people. AI agents in the plugin have their own reference, which
they read by themselves.
