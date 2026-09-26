# Settings

What the plugin's own settings are and what each group of them decides, for `read_settings` and
`write_settings`. Paths are dotted: `tasksFolder`, `ai.chatFolder`, `ai.agents.0.name`. One
setting per write, and the new value must be of the same type as the old one — read it first.

## Reading and changing them

`read_settings` with no arguments lists every setting with its value, or with its size when it
is a list or an object. With `path` it returns that one value as JSON; a list too long to return
whole comes back as one line per item — its place, id and name. `write_settings` takes a
`path` and a `value` and changes exactly that.

In a list, a path segment names one item by its place, its `id`, or its `name` (a label colour
by its `value`, a list of words by the word): `ai.agents.Writer.prompts`,
`headerButtons.<id>.icon`, `logsNotesTypes.log`. A name several items share is refused — use
the id.

## Changing one item of a list

Lists — `ai.agents`, `headerButtons`, `automations`, `links`, `journals`, `ai.providers`,
`taskLabelColors` and the rest — are changed one item at a time with `write_settings`' `op`,
never by writing the whole list back:

- `update` with `path` naming an item and `value` a JSON object of only the fields to change:
  `{"op":"update","path":"ai.agents.Writer","value":"{\"modelId\":\"m2\"}"}`. Nested objects
  merge — `{"toolModes":{"fetch":"ask"}}` changes one tool's mode — and `null` removes a field.
- `add` with `path` naming the list and `value` the new item; `index` inserts it at a place,
  otherwise it goes last. An agent, button, link, automation or journal is filled in with the
  same defaults the settings screen gives it, and gets an id when it has none.
- `remove` with `path` naming the item.
- `move` with `path` naming the item and `index` its new place.

Each answers with the one item it touched, which is also where its new id is. The same rules as
any write hold: types keep, keys stay out of reach, an interceptor has to be another agent.
`set` on a whole list still works, and a keychain id it was shown as `<hidden>` stays as it was.

Three rules hold for every write. The setting has to exist already: this changes settings rather
than inventing them, and a key the plugin never reads would otherwise sit in the file for good.
The type has to match, so a folder name cannot become a list by accident. And keys and their
keychain ids are neither readable nor writable — `ai.secrets`, anything named `apiKeyId` or
`token`, the search key, and `secretStore`, the synced keys (below). The chat index,
`ai.chatHistory`, is a cache rebuilt from the vault and is out of reach for the same reason a
cache always is.

Say what changed afterwards. A setting is the person's, and a change they did not notice is a
change they cannot undo.

## Notes, tasks and journals

`tasksFolder` is where new tasks go; `tasksTimeChoices`, `tasksDateChoices` and
`tasksRecurrenceChoices` are the quick answers the task editor offers. `logsNotesTypes` names
the note types that count as logs — a note whose `type` is one of these is a log wherever it is
found, which is what the **Logs** list under a note is built from. `journals` are the journals
themselves, each with its own folder and note template. `weekStartsOnMonday` and
`busyDayThreshold` are the calendar's; `excludedPathsForDefaultTemplate` is where the default
template is deliberately not applied. `taskLabelProperty` is the task property labels are read
from (`labels` unless changed), and `taskLabelColors` gives a label a colour — a list of
`{ value, color }`, `color` one of `red`, `orange`, `yellow`, `green`, `cyan`, `blue`,
`purple`, `pink`. A label with no entry is grey.

## Finance and time

`accountsFolder`, `financeCategoriesFolder`, `transactionPathTemplate` and
`transactionTemplatePath` decide where a new transaction and its account land and what they are
made from. `defaultCurrency` and `pinnedCurrencies` are what the finance sidebar shows first.
`accountsList` is what the accounts sidebar lists: `sort` (`size` — the balance's magnitude —,
`balance` or `name`), `groupByType`, `types` (account types shown), `hideZero`, `showExcluded`
(accounts marked `excludeFromTotal`) and `currency` (one currency, or every one when empty).
`fireflyBaseUrl` is the Firefly III server a migration reads from; its token is in the keychain
(and in the synced keys when those are on), never in the settings — `fireflyToken` exists only
in old settings files and is moved to the keychain the next time the settings are saved.
`timeEntryPathTemplate` is where a time entry is written; `timeTrackableNoteTypes` and
`timeTrackAllNotes` decide which notes get the timer button in their header.

## The agent

Everything under `ai.`. `ai.enabled` is the whole feature. `ai.providers` are the model
providers with their models; `ai.activeProviderId` and `ai.activeModelId` are the ones a new
chat starts on, and `ai.auxiliaryModelId` is the background model that writes titles, recaps,
summaries and compactions. `ai.agents` are the agents themselves — each with its own prompt, scope, tools
and model, its own background model (`auxiliaryProviderId`, `auxiliaryModelId`) and its own
interceptor (`interceptorAgentId`, another agent's id or empty, and `interceptorContextDepth`) —
and `ai.defaultAgentId` is the one a new chat opens with. `ai.commentAgentId` is
the agent a comment starts on, and `ai.commentFolder` and `ai.chatFolder` are where comments
and chats are written.

`ai.permissionMode` and `ai.toolModes` are permissions: the first decides whether writes are
confirmed, and the second holds one mode per tool — `off`, `ask` or `auto`. `ai.defaultScope`
and `ai.defaultFullVaultAccess` are what a chat may reach when its agent says nothing. Changing
any of these changes what an agent — including the one being asked — is allowed to do, so it is
the last thing to change quietly.

`ai.prompts` holds the built-in prompts: `system`, `titleGeneration`, `recapPrompt`,
`summaryPrompt`, `compactPrompt`, `memoryTemplate` and `toolDescriptions`. `toolDescriptions`
holds overrides only — tool name to the text the person wants that tool to tell the model
instead of its own — and is usually empty. A tool's default description lives in the tool, not
in the settings; an entry equal to it, or to a default an older version saved there, is dropped
when the settings load, so writing one changes nothing. To change a description, write text
that differs; to go back to the default, remove the entry. `memoryTemplate` lays an agent's memory into
its system prompt, with `{{memory}}` standing for the list of items; an agent with no memory gets
nothing. The memory itself is `ai.agents.N.memory` — a list of `{ id, text, created }`, one
agent's own, added to and changed by `remember`, pruned by `forget`, and edited in that agent's
settings. `ai.scriptsEnabled` and `ai.scriptsFolder` are the script feature; `ai.voice` is
dictation — which model transcribes and where its key lives.

`ai.mcpServers` are the MCP servers the person connected, each `{ id, name, url, enabled, keyId,
headers, tools, fetchedAt }`. `url` is the server's MCP endpoint, reached over HTTP; `keyId`
names the keychain slot of a token sent as `Authorization: Bearer`; `headers` are sent as
written, a value naming a stored key as `${abele_key:name}`. `tools` is the list as it was last
fetched from the server, and it is what agents are told — fetching again is done in the
settings, where the person sees the new list. The tools themselves are `mcp_<server>_<tool>` in
`toolModes`, off for an agent until given; see the tools section.

## Maps

`mapCoordinatesProperty` is the note property a place is stored in — `coordinates` unless the
person changed it, and the map tools tell the person to write into whichever it names.
`mapStyleUrl` replaces the free OpenFreeMap tiles with a MapLibre style of one's own; empty
means the plugin's own, which needs no key and no account.

## GitHub

`github.enabled` is the whole integration, off unless the person turned it on: GitHub issues,
pull requests, discussions, commits and files at a ref open in tabs of their own, read only.
`github.openLinks` decides whether a click on such a link in a note opens that tab instead of
the browser. `github.server` is a GitHub Enterprise address, empty for github.com.
`github.keyId` names the keychain slot holding the person's fine-grained token and, like every
key, is out of reach of these tools. The token needs read access to Contents, Issues, Pull
requests and Discussions; without one only public repositories open, and discussions not at all.
While it is on, agents also have the read-only GitHub tools (the `tools` section, GitHub); with it
off they are not offered at all.
`github.defaultRepo` is the repository (`owner/repo`, or a link into it; empty by default) where
the command *Open GitHub link or item* looks up a bare `#123`, a title, a branch or a commit when
no GitHub tab has been used and nothing was opened from it yet this session.
`github.searchLimitMb` (100 by default) is the largest repository — its files at that commit
added up, in megabytes — that a tab's code search, go to definition or `github_grep` downloads
whole to search; a larger one is searched through GitHub's own code search instead, on the
default branch only.
`github.userDisplay` is what a person in a GitHub tab — an author, a commenter, a reviewer, a
commit's author — is shown by: `name` (the default), the name on their GitHub profile with their
picture, or `login`. The other one is in the tooltip, and a click on the person swaps the two in
place; someone whose profile has no name shows their login either way. Names and pictures are
kept on the device for a week (see the vault reference, GitHub people), not in these settings.
`github.pageWidth` is how wide a GitHub tab's text runs — conversations, commit messages,
rendered markdown, folder pages: `readable` (the notes' own line width), `custom` (the default,
`github.pageWidthPx` pixels, 1000 unless changed, from 400 to 4000) or `full` (the whole tab).
Diffs and code always take the whole tab. A change shows in open tabs at once.

## Calendars

`calendars.feeds` are the external calendars whose events show beside the tasks — in the sidebar
calendar, the sidebar timeline (today onward) and a daily note's footer (that day) — read only:
nothing is written to them, and no note is made from an event unless the person picks *Create
meeting note* on it. Each has an `id`, a `name`, a `color` (one of the named theme colours,
`blue` … `pink`), `enabled`, and a `source`: `ics`, a secret calendar link from Google, iCloud
or Outlook, or `caldav`, an account on a CalDAV server (`server`, `username`, and `calendarUrl`
for one of its calendars — empty for all of them). `keyId` names the keychain slot holding the
link or the CalDAV password; like every key it is out of reach of these tools, so a person adds
or changes one in **Settings → Calendars** themselves. A calendar added here without its link
shows nothing until they do. `calendars.refreshMinutes` (30 by default, 5 at least) is how often
they are read again while Obsidian is open; they are also read at startup and when their
settings change. What was last read is kept on the device (see the vault reference, Calendar
cache), so the lists show it without a network.

## Synced keys

Keys and tokens live in each device's own keychain, and a setting only names the slot. With
**Settings → Transfer → Synced keys** turned on, every key the plugin holds is also kept in one
encrypted store inside the plugin's settings file, `secretStore`, so it reaches the person's
other devices with the settings: each device is unlocked once with a passphrase and then has
every key, and a key added or changed on any device reaches the rest. Keys are still put into
each unlocked device's keychain, so turning the store off leaves them where they are.

`secretStore` is not a setting: it is neither readable nor writable here, it is not carried by
a settings transfer, and nothing in it can be read without the passphrase. Status, unlocking,
changing the passphrase, removing the keys from one device and turning it off are all on that
screen and nowhere else. When a key the person expects is missing on a device, the answer may
be that synced keys are locked there — say so rather than asking for the key again.

The same screen has **All keys**, the person's own list of every key the plugin knows on the
device — what each is for, where it is used, whether it is set and synced — where each can be
shown or copied and all of them copied at once. It is theirs alone: no tool reads it or its
values, and none should be asked to. Send a person who wants to see or copy a key there, or to the field the key was entered in:
every one of them has the same show and copy icons beside the stored key.

## Everything else

`snippetsFolder` is where CSS snippets are written, `links` and `headerButtons` are the buttons
and links added to note headers, `fullWidthSidebars` widens the sidebars to the whole screen on
a phone and `halfWidthSidebarsOnTablet` to half of it on a tablet, `mermaidViewer` (on by
default) draws mermaid blocks with the plugin's zoomable viewer instead of Obsidian's own,
`propertyWidgets` (on by default) draws some properties itself — a wallet's balance, sums in
number fields, file cards for File and Files properties and `cover` — and
`refreshDelay` is how long the plugin waits before rebuilding what a note shows.

`quickButton` is the floating button on a phone: `enabled` (off by default, it is a concept),
`tablet` (a tablet too), `side` (`right` or `left`), `lift` (pixels above where it rests,
dragged there by hand) and `actions`, the person's own entries at the top of its menu — each
`{ id, type, commandId, scriptName, name, icon }`, `type` being `command` or `script`. A command
entry is left out of the menu wherever the command cannot run. It travels in a transfer.

`keyboardDiagnostics` shows a panel at the top of the screen with what the app reports about
the on-screen keyboard — page and viewport sizes, Obsidian's keyboard height, the open dialog
and the focused field, the last keyboard events. It is a troubleshooting aid, off by default,
and is not carried by a settings transfer.

A header button runs `scriptName` with `params`, and shows on notes whose `type` is in
`noteTypes`, on notes anywhere under one of `folders`, or on every note when `allNotes` is on —
task notes included. `conditions` narrows that further by the note's frontmatter: each is
`{ property, test, value }`, `test` one of `equals` (the property is `value`, or holds it in a
list; case is ignored and `Garden` matches `[[Garden]]`), `not-equals` (anything else, a missing
property included), `filled` or `empty`. `conditionMode` is `all` (the default) or `any`. A
button with conditions and no `noteTypes`, `folders` or `allNotes` shows on any note that fits
them. `icon` is a Lucide name without its `lucide-` prefix (`calendar`, `play`); the settings
pick it from a grid. `enabled: false` keeps it configured but hidden, `iconOnly` leaves its
`name` off the header, and the order of the list is the order in the header.

`automations` is the list of scripts that run by themselves (the `scripts` docs, Automations).
Each rule has `event` — one of `task.completed`, `task.reopened`, `task.created`,
`task.changed`, `task.date-changed`, `note.created`, `note.changed`, `note.renamed`,
`note.deleted` — and runs `scriptName` with `params` (templates, as for a header button) on
notes whose `type` is in `noteTypes` (empty is any; ignored for task events), under one of
`folders` (empty is anywhere), and, when `property` is set, whose property equals `value` (or
is filled in, when `value` is empty). `throttleSeconds` is how often at most it runs for one
note, 0 for every change; `includeExternal` also runs it for changes that arrived by sync;
`enabled: false` keeps it without running it. A rule an agent adds needs an `id` of its own.
