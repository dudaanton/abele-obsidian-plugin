# Commands

What the person can do from the command palette. An agent cannot run these, but knowing them is
how to answer "how do I…" without inventing an answer — and how to hand back a step that is
genuinely theirs to take. Every one is prefixed **Abele:** in the palette.

## Tasks and notes

- Create new task — opens the task dialog: title, date, due date, repeat, and the description in
  the same editor a note is written in. *Open as note* saves and goes to the note. *Create new
  task and insert into current note* still creates the note directly and leaves a link behind
- Create note from template · Insert template at cursor · Replace current note with template
- Create note in group
- Open today's daily note
- Paste from clipboard at cursor
- Insert colored highlight · Remove colored highlight
- Reindex footnotes

## Finance and time

- Create new transaction — opens the transaction dialog: the amount (it takes a sum, `3.50 + 2×1.20`),
  the accounts on both sides with their balances, a second amount and the rate when the accounts
  are in different currencies, category, groups, description. *Next* saves and starts another on
  the same day between the same accounts. *…and insert into current note* still creates the note
  directly
- Start timer for current note · Stop active timer
- Show finance sidebar · Show accounts sidebar · Show time tracking sidebar

## Views

- Show timeline sidebar · Show todo sidebar · Show AI chat sidebar
- Chat about current note — a new chat with a link to that note ready in the input, and access
  to it if the agent had none; *Chat about this* when a note is right-clicked does the same.
  With text selected in that note, the link points at the selected lines and the text is
  quoted under it
- Attach a chat to current note — picks a chat from the history and links it to the note, the
  same link a chat makes by writing to it, so it appears in the note's **Chats** list; *Attach a
  chat…* when a note is right-clicked does the same. From a chat, the link button in its header
  attaches it to the note in front or to one picked, and detaches it; under the note, the unlink
  button on a chat's card detaches it. Scripts take chats the same way, and list them under their
  code. An agent cannot attach chats itself
- Show script runs · Show script API reference
- Open GitHub link or item — the GitHub link under the cursor opens straight away; otherwise a
  picker takes a pasted link (github.com or the configured server), or `#123`, `owner/repo#123`,
  a commit SHA, a branch, `owner/repo`, or words of a title, and offers what GitHub has for it
  while typing — pull requests, issues and discussions by number or title, branches, commits,
  repositories. A bare number or a title is looked up in the repository of the GitHub tab used
  last, else the one last opened from the picker, else `github.defaultRepo`. It opens in the tab
  already showing that item, else the GitHub tab used last, else a new one; Mod+Enter opens a new
  tab. The same picker is *Open another GitHub item…* in a GitHub tab's "more options" menu (only
  while the GitHub integration is on)
- Chat about this GitHub item — in a GitHub tab: a new chat with a link to the item in the
  input. The same is the speech-bubble button in the tab's header and in its "more options"
  menu; *Ask here* under selected lines of code starts one with those lines quoted, and so does
  *Chat about this* while lines are selected

## Media

- Insert image gallery · Convert images on page to galleries
- Set cover from first image/video in note
- Import files to vault · Save remote media to vault
- Find and delete unused media · Deduplicate media attachments

## Bulk and migration

- Find and replace in frontmatter and content of all notes, matching the criteria
- Migrate tasks from Dataview · Migrate from Dataview fields
- Migrate data from Firefly III · Migrate time entries from Toggl

## Other

- Open documentation — the plugin's own documentation for people, page by page with a search
  over it; also the **Documentation** button at the top of the plugin's settings. Send a person
  there for a walk-through rather than retelling it
- Create script · Create CSS snippet · Reload CSS snippets
- Dictate into the note — records, transcribes, and puts the words at the cursor

Each script in the vault also appears as its own command, **Script: <name>**.
