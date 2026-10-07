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
- Cycle checkbox state — cycles an inline checklist on the current editor line through Open,
  In progress, Done, Cancelled, Forwarded, Scheduled, Question and Important. Not a task-note
  completion command; the checkbox's context menu offers the same states directly
- Copy link to selected lines — copies a link to the selected line range in the current note
- Comment here — opens an AI comment chat for the selected passage
- Add comment — opens a free-form text comment dialog for selected ordinary-note text, with
  colour or underline, rich Markdown editing and dated entries. Works with AI disabled and
  is also in the editor selection menu; reading-mode selections can use the command palette

## Presentations

- Open presentation — view the current `type: presentation` note as a deck
- Preview presentation beside editor — retain the source editor and open a live deck beside it
- Play presentation — show on one screen, desktop fullscreen or a full-window mobile overlay
- Present with speaker view — open an audience popout on desktop and show current/next slides,
  notes and timer in the original tab; mobile uses a local full-window presenter

## Finance and time

- Create new transaction — and *Create new transaction and insert into current note*, which leaves a link behind
- Start timer for current note · Stop active timer
- Show finance sidebar · Show accounts sidebar · Show time tracking sidebar

## Views

- Show timeline sidebar · Show todo sidebar · Show AI chat sidebar
- Агенты — lists conversations needing an explicit approval, an answer or acknowledgement of a
  stopped-run error, plus current local work and incomplete connection coverage. The activity
  ribbon and shared chat header open the same modal. Counts conversations, not operations;
  returns to existing chats/discussions without running models or approving from the list.
  Local execution evidence survives closed tabs and restart; Node all-session summary coverage
  is currently marked incomplete rather than inferred from open tabs.
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
- Find in the current chat — opens search within the conversation in front
- Open quick menu — opens the configured quick actions without pressing the floating button
- Show script runs · Show script API reference
- Review scripts waiting for confirmation — reviews scripts awaiting this device's approval
- Review key destinations — confirms new service addresses on this device and manages explicit
  home-network HTTP exceptions. Keys stay held until the recipient is approved here
- Open GitHub link or item — the GitHub link under the cursor opens straight away; otherwise a
  picker takes a pasted link (github.com or the configured server), or `#123`, `owner/repo#123`,
  a commit SHA, a branch, `owner/repo`, or words of a title, and offers what GitHub has for it
  while typing — pull requests, issues and discussions by number or title, branches, commits,
  repositories. A bare number or a title is looked up in the repository of the GitHub tab used
  last, else the one last opened from the picker, else `github.defaultRepo`. It opens in the tab
  already showing that item, else the GitHub tab used last, else a new one; Mod+Enter opens a new
  tab. The same picker is *Open another GitHub item…* in a GitHub tab's "more options" menu (only
  while the GitHub integration is on)
- Open node repository — choose a connected node, registered project and workspace, then browse
  its repository in the same tab layout as GitHub. Workspaces include the original checkout,
  node worktrees and opted-in external worktrees. Working tree shows local changes above HEAD;
  branches and commits stay frozen until deliberately refreshed. Human browsing does not grant
  an agent access. The workspace files dialog offers the same entry point
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
  bulk Done REST endpoint. Bulk Read passes the displayed page's cutoff as `last_read_at`,
  without forcing `read: true`; another panel's polling cannot advance that cutoff. Polling
  keeps disappeared rows dimmed until refresh or filter change, except explicitly Done versions.
  Done uses the displayed row's original client and string thread ID. Non-204 replies leave the
  row visible with a lasting error naming the HTTP status, thread ID and token field; refresh
  alone does not clear it. If GitHub accepts Done but lists the unchanged version again, a notice
  labels it as a session-local fallback (last 1,000 Done versions per client, not saved or synced).
  **Show locally hidden** forgets that fallback. Changed timestamps, comment/review URLs, reasons
  or subject details reappear; read/unread changes alone do not. No PR-reason blacklist is used.
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

- New drawing — creates a drawing and opens it
- Insert a new drawing — creates a drawing and embeds it at the cursor
- New canvas — asks for a name, creates an empty `.canvas`, and opens the human editor. Its
  controls add text, files and links; completing text publishes one shared-session transaction
- Open current canvas in diagram viewer — opens the active `.canvas` in the Abele editor,
  even when the default-opening setting is off. Steps play with camera framing and
  narration; the header's native Canvas action returns that leaf to the editor
- Insert columns · Insert two equal columns · Insert three equal columns · Insert text with an aside
- Column options · Remove columns — edit the current quote frame without discarding its content
- Insert image gallery · Convert images on page to galleries
- Set cover from first image/video in note
- Import files to vault · Save remote media to vault
- Find and delete unused media · Deduplicate media attachments

## Reading

- Toggle e-ink mode for books on this device — switches the reader's device-local e-ink presentation
- Toggle zen mode for books on this device — switches the reader's device-local distraction-free presentation

## Bulk and migration

- Find and replace in frontmatter and content of all notes, matching the criteria
- Migrate tasks from Dataview · Migrate from Dataview fields
- Migrate data from Firefly III · Migrate time entries from Toggl

- Lint current note · Lint folder… · Lint vault · Open linter — the linter's run shown in its own
  tab, grouped by note or rule, with fixes; also **Lint this note** / **Lint this folder** in the
  file menus. The `lint` and `lint_fix` tools do the same for an agent

## Sync

These commands use a self-hosted **abele-sync** server configured on the Sync tab; there is
no hosted service.

- Sync now · Pause or resume sync
- Open sync log — also a click on the sync item in the status bar
- Open deleted files — what was deleted anywhere in the vault, each with a Restore, and
  *Restore all deleted since…* for everything deleted since a moment
- *Open version history (Abele)* when a file is right-clicked, while the device is connected

Connecting, disconnecting and choosing what a device syncs are on the Sync tab of the settings,
and so are the devices on the vault. Three dialogs open by themselves rather than from a command:
the join question when a device connects to a vault that already has files (from the vault it was
picked on, or from the Sync tab for a device a transfer connected), *Deletions held back* when many
files were deleted at once on this device, and *Settings changed on another device* when Obsidian
settings arrived. The last two stay on the Sync tab until they are answered.

## Other

- Open changelog — every plugin version in a tab, newest first, with dated changes grouped as new features, fixes and improvements; also **Settings → Other → Changelog**. Works with AI off and without a network
- Open documentation — the plugin's own documentation for people, page by page with a search
  over it; also **Documentation** at the top of each tab of the plugin's settings. Send a person
  there for a walk-through rather than retelling it
- Create script · Create CSS snippet · Reload CSS snippets
- Dictate into the note — records, transcribes, and puts the words at the cursor

Each script in the vault also appears as its own command, **Script: <name>**.
