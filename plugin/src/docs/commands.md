# Commands

What the person can do from the command palette. An agent cannot run these, but knowing them is
how to answer "how do I…" without inventing an answer — and how to hand back a step that is
genuinely theirs to take. Every one is prefixed **Abele:** in the palette.

## Tasks and notes

- Create new task — and *Create new task and insert into current note*, which leaves a link behind
- Create note from template · Insert template at cursor · Replace current note with template
- Create note in group
- Open today's daily note
- Paste from clipboard at cursor
- Insert colored highlight · Remove colored highlight
- Reindex footnotes

## Finance and time

- Create new transaction — and *…and insert into current note*
- Start timer for current note · Stop active timer
- Show finance sidebar · Show accounts sidebar · Show time tracking sidebar

## Views

- Show timeline sidebar · Show todo sidebar · Show AI chat sidebar
- Add to agent context — adds the note (or its selected passage) to the chat in front and
  opens the agent sidebar. File and folder menus offer the same action
- Chat about this — a new chat with a link to that note ready in the input, and access
  to it if the agent had none. The note's context menus offer the same action.
  With text selected in that note, the link points at the selected lines and the text is
  quoted under it
- Attach to a chat — picks an existing chat and inserts a wikilink to the note into its input,
  keeping any draft already there and giving that chat access to the note. Nothing is sent
- Attach a chat to note — picks a chat from the history and links it to the note, the
  same link a chat makes by writing to it, so it appears in the note's **Chats** list. From a chat,
  the link button in its header attaches it to the note in front or to one picked, and detaches it; under the note, the unlink
  button on a chat's card detaches it. Scripts take chats the same way, and list them under their
  code. An agent cannot attach chats itself
- Search all chats — opens the chat history. Search matches titles and the descriptions shown
  under them by default. Turn on **Content** beside the field to also search sent user and
  assistant messages, with snippets that open at the matching message. The switch is off on a
  new device and remembered only on that device. Its first content search reads all chats once;
  later searches reread only changed chats. Cmd/Ctrl+F inside a chat still searches that whole
  conversation, including reasoning and tool results, regardless of the history switch
- Copy wikilink — copies a wikilink to the note, even when the vault uses Markdown links.
  Also available in the note's context menus and mobile quick menu with the AI switched off
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
- Open GitHub repository… — a picker of repositories: pinned ones (`github.pinnedRepos`), the ones
  opened lately on this device, the account's own and the starred ones (with a token, asked of
  GitHub once an hour), and GitHub's repository search for what is typed; `owner/repo` typed whole
  is offered as itself. A choice opens the repository's front page, Mod+Enter in a new tab;
  Alt+Enter pins or unpins the row. A GitHub tab's "more options" menu has the same command, and
  **Pin repository** / **Unpin repository** for the repository it shows (only while the GitHub
  integration is on)
- Show GitHub notifications — the account's GitHub inbox in the right sidebar: All (read and
  unread, not Done) by default, or Unread; one repository or all. Old unread-only saved panels
  migrate once to All. A click opens the pull request, issue, commit or discussion in a GitHub
  tab (at the latest comment) and leaves it unread. Every row's check means Done on GitHub
  (DELETE thread), removing it from both inboxes, not unsubscribing. The panel's double check
  marks all read (of the chosen repository), not Done: read rows remain in All. There is no
  bulk Done REST endpoint. Polling keeps disappeared rows dimmed until refresh or filter change.
  Releases, workflow runs and alerts open on GitHub. Needs a classic token with the
  `notifications` or `repo` scope — GitHub does not let a fine-grained token read notifications —
  read from its own setting, `github.notifications.keyId` (Notifications token), else the main
  token. Successful replies without `repo` in `X-OAuth-Scopes` show a quiet private-access hint;
  `X-GitHub-SSO: partial-results` hints at missing organization authorization. Neither blocks
  the list or changes which token scopes are required.
  Also in a GitHub tab's "more options" menu (only while the GitHub integration is on)
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

- Lint current note · Lint folder… · Lint vault · Open linter — the linter's run shown in its own
  tab, grouped by note or rule, with fixes; also **Lint this note** / **Lint this folder** in the
  file menus. The `lint` and `lint_fix` tools do the same for an agent

## Other

- Open changelog — every plugin version in a tab, newest first, with dated changes grouped as new features, fixes and improvements; also **Settings → Other → Changelog**. Works with AI off and without a network
- Open documentation — the plugin's own documentation for people, page by page with a search
  over it; also **Documentation** at the top of each tab of the plugin's settings. Send a person
  there for a walk-through rather than retelling it
- Create script · Create CSS snippet · Reload CSS snippets
- Dictate into the note — records, transcribes, and puts the words at the cursor

Each script in the vault also appears as its own command, **Script: <name>**.
