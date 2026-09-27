# Settings

Service keys are bound to configured origins. An origin introduced by sync, import or
`write_settings` is held until the person runs **Review key destinations** on this device.
Saving an unrelated setting does not approve it. Editing the actual destination in its local
settings screen does. Initial upgrade records existing destinations once; later approvals are
device-local and never travel with settings. GitHub's connection transport is separate.

Named saved keys have an `allowedOrigins` list. It travels with their settings, but approvals
do not: each device confirms newly arrived origins. The request confirmation can add an address;
the key's card in AI → General → Secrets shows the list and lets the person remove addresses.
A permitted origin does not remove the per-request question.

Keys use HTTPS, except loopback HTTP and explicitly allowed home-network HTTP origins (port
included). **Review key destinations** shows the unencrypted warning and lets the person allow
or remove those exceptions. The dialog also accepts an address when its pending list is empty:
choose the concrete saved key or explicitly save a new named key in protected storage, then
**Allow key and address** records that key-recipient pair and the local HTTP exception when
needed. The canonical scheme, host and port and the unencrypted warning are shown beside the
action. A name collision never overwrites an existing key. Retry the original literal-header
script afterwards; no script is replayed automatically. The key-recipient permission remains visible after saving and reopening. Removing that
permission keeps the saved key and other keys' permissions; the separate HTTP exception
controls unencrypted transport for the address on this device. Other keys do not gain
permission from the HTTP exception. An imported named HTTP permission that is unconfirmed
here shows the unencrypted warning and explicit HTTP action on its own row, even with a blank
form. Cancelling script consent while persistence is pending aborts the owned operation and
waits for rollback; multi-key approval never resolves subsequent names to newly rebound keys.
Public HTTP is not eligible. Keyless local services are unchanged.


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
any write hold: types keep, keys stay out of reach, an interceptor has to be another agent and
its pattern has to compile.
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
`busyDayThreshold` are the calendar's; `birthDate` (`YYYY-MM-DD`, empty when unset) and
`lifeExpectancy` (years, 80 by default) are what a calendar base's life in weeks is drawn from; `excludedPathsForDefaultTemplate` is where the default
template is deliberately not applied. `taskPriorityProperty` (default `priority`) selects the
property tasks read and write for priority; it is independent of the widget-only
`priorityProperties` name list. Existing note content is not migrated. `taskLabelProperty` is the task property labels are read
from (`labels` unless changed), and `taskLabelColors` gives a label a colour — a list of
`{ value, color }`, `color` one of `red`, `orange`, `yellow`, `green`, `cyan`, `blue`,
`purple`, `pink`. A label with no entry is grey.

## Finance and time

`accountsFolder`, `financeCategoriesFolder`, `transactionPathTemplate` and
`transactionTemplatePath` decide where a new transaction and its account land and what they are
made from. An empty `transactionPathTemplate` keeps existing transaction paths unchanged;
new and imported transactions use their titles in the vault root. `defaultCurrency` and
`pinnedCurrencies` are what the finance sidebar shows first.
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
interceptor (`interceptorAgentId`, another agent's id or empty, and `interceptorContextDepth`; or
`interceptorScript`, the name of a script marked `@interceptor`; and `interceptorPattern`, a
regular expression narrowing which messages it sees, refused when it does not compile) —
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
settings. `ai.scriptsEnabled` and `ai.scriptsFolder` are the script feature, and `ai.toolbarScripts`
the names of the scripts pinned to the toolbar, `ai.startupScripts` the scripts run when the
plugin starts, in order, with the devices each runs on, and `ai.startupScriptsPaused` the switch
that skips them (see the scripts section); `ai.confirmForeignScripts` holds a script that changed
without being written on a device until it is confirmed there — it switches a device on, but
whether a device checks, and what it has confirmed, is kept on that device, not in this file, so
turning it off here does not turn it off anywhere; `ai.voice` is
dictation — which model transcribes and where its key lives.

`ai.mcpServers` are the MCP servers the person connected, each `{ id, name, url, enabled, keyId,
headers, tools, fetchedAt }`. `url` is the server's MCP endpoint, reached over HTTP; `keyId`
names the keychain slot of a token sent as `Authorization: Bearer`; `headers` are sent as
written, a value naming a stored key as `${abele_key:name}`. `tools` is the list as it was last
fetched from the server, and it is what agents are told — fetching again is done in the
settings, where the person sees the new list. Tools are offered as `mcp_<server>_<tool>` aliases,
with collision suffixes when needed. In `toolModes` their keys are `mcp:` plus the JSON pair
`[server.id, originalToolName]`, independent of the server's label. They are off for an agent
until given; see the tools section. `ai.mcpLegacyToolMap` is the frozen upgrade-time ownership
of legacy aliases, used to migrate old chat permissions when those chats are opened later.
Renames and newly connected servers do not change that snapshot.

## Editor syntax highlighting

`editorSyntaxHighlight` (on by default) fills fenced-code language gaps in Source and Live
Preview with Obsidian's Prism and the current theme's token colours. Native editor tokens,
rendered blocks and reading-view highlighting stay unchanged. The switch is in **Other**,
travels with that settings section, and takes effect in already-open editors. See `display`
for the visible-range cache and large-block limits. Inline code is not language-highlighted.

## Maps

`mapCoordinatesProperty` is the note property a place is stored in — `coordinates` unless the
person changed it, and the map tools tell the person to write into whichever it names.
`mapStyleUrl` replaces the free OpenFreeMap tiles with a MapLibre style of one's own; empty
means the plugin's own, which needs no key and no account.

## GitHub

`github.enabled` is the whole integration, off unless the person turned it on: GitHub issues,
pull requests, discussions, commits and files at a ref open in tabs of their own, read only.
`github.openLinks` decides whether a click on such a link in a note opens that tab instead of
the browser. `github.connections` lists named connections with stable IDs, a `server` address
(empty for github.com), `owners` preferences and `isDefault` per server. Optional `account`
metadata is discovered by the access check, not typed by an agent. Every connection's `keyId`
names its keychain slot and is out of reach of these tools. `github.server` and `github.keyId`
remain compatibility projections for old plugin versions, not a second list of connections.
Each agent's `githubConnections` map stores `off`, `ask` or `auto` per stable connection ID.
The UI calls these Off, Ask and On. Missing/new IDs are Off for all hosts. On upgrade, a saved
agent without this map retains access only to the migrated single-server `github-legacy`
connection, matching its existing GitHub tool modes (Auto if any is Auto, otherwise Ask if any
is Ask). An existing map, including an empty map or explicit Off, is never changed. New agents
start with an empty map. This repair also applies if the credential was migrated earlier.
A chat's tool-mode
overrides cannot grant a connection the executing agent lacks; connection permission is separate
from the tool's own Ask/Off/Auto mode.
The token needs read access to Contents, Issues, Pull
requests and Discussions; without one only public repositories open, and discussions not at all.
While it is on, agents also have the read-only GitHub tools (the `tools` section, GitHub); with it
off they are not offered at all.
`github.defaultRepo` is the repository (`owner/repo`, or a link into it; empty by default) where
the command *Open GitHub link or item* looks up a bare `#123`, a title, a branch or a commit when
no GitHub tab has been used and nothing was opened from it yet this session.
`github.pinnedRepos` is the list of repositories pinned to the top of the command *Open GitHub
repository…*, in the order pinned, each `{ url }` with the repository's own address
(`https://github.com/owner/repo`, or the Enterprise server's), so a pin names its server. It
travels with the GitHub settings. The repositories opened lately are not here: they are this
device's own, in Obsidian's local storage.
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

## Sync

`sync` holds only what every device on the vault shares: `sync.keySignature`, stored but not yet
applied. The vault-wide policy — merge or conflict file, the server's size cap, how long history is
kept — is on the server, not here.

This device's connection is not a setting at all. Which server and vault it syncs, the device it
enrolled as and the keychain slot its token is in (always named `abele-sync-device-…`), whether it
is paused, and what of the vault it takes — the kinds of attachment, the folders it skips, its size
cap, which parts of the config folder travel — are kept in Obsidian's local storage for this vault
(see the vault reference), because `data.json` is exactly what a copy of the vault or a transfer
hands to another device. They are changed on the Sync tab: signing in sets the connection,
**Disconnect** and **Forget** clear it — and tell the server to stop accepting this device, so
connecting again needs the password — and the switches under **What this device syncs** change
what it takes. While the device holds a token its server address cannot be pointed at
another server — the token goes only to the server that minted it — so moving it means
**Disconnect** and a new sign-in; the address it enrolled on and the revokes still waiting to be
told are not settings at all, and are never written from outside. A transfer can also set it: its **Sync connection** section, sent with keys, gives
the other device a device of its own on the same vault. A `data.json` that still names a server or a vault — written by an older version of
Abele — has those fields dropped when it is read, and they are never written back.

The server address is an https one, or plain http to a server on this device (`localhost`,
`127.0.0.1`, `[::1]`); any other plain-http address is refused, and a device saved with one does not
sync until it signs in again. A phone that has not chosen a size cap takes files up to 50 MB; a
desktop takes everything. Notes and canvases always sync; the config folder syncs only when it is
`.obsidian`, and other hidden files and folders never sync from the plugin.

## Synced keys

Keys and tokens live in each device's own keychain, and a setting only names the slot. With
**Settings → Transfer → Synced keys** turned on, every key the plugin holds is also kept in one
encrypted store inside the plugin's settings file, `secretStore`, so it reaches the person's
other devices with the settings: each device is unlocked once with a passphrase and then has
every key, and a key added or changed on any device reaches the rest. Keys are still put into
each unlocked device's keychain, so turning the store off leaves them where they are. The one
key never in the store is the device sync token: each device enrols with the sync server and
keeps its own, since a device given another's token would sync as that device.

`secretStore` is not a setting: it is neither readable nor writable here, it is not carried by
a settings transfer, and nothing in it can be read without the passphrase. Each transfer section
writes only its own fields; keychain writes are limited to the references in the accepted
incoming settings, not the sender's list of slots. Status, unlocking,
changing the passphrase, removing the keys from one device and turning it off are all on that
screen and nowhere else. When a key the person expects is missing on a device, the answer may
be that synced keys are locked there — say so rather than asking for the key again.
New and changed store passphrases require at least 12 characters; existing shorter ones still
unlock. A present but malformed store is damaged, not disabled: local keys and the device's
saved unlock key stay in place until a valid copy is restored.

The same screen has **All keys**, the person's own list of every key the plugin knows on the
device — what each is for, where it is used, whether it is set and synced — where each can be
shown or copied and all of them copied at once. It is theirs alone: no tool reads it or its
values, and none should be asked to. Send a person who wants to see or copy a key there, or to the field the key was entered in:
every one of them has the same show and copy icons beside the stored key.

## Changelog

**Settings → Other → Changelog → Open changelog** opens all versions. This is an action,
not a writable setting. On a later update a dismissible notice can open the versions since
this device last ran the plugin. The version marker is local to this device and vault, not
in the settings or settings transfer; on the first version with this feature it is set
silently because older versions kept no marker.

## Everything else

`snippetsFolder` is where CSS snippets are written, `links` are the links added to note
headers, `fullWidthSidebars` widens the sidebars to the whole screen on
a phone and `halfWidthSidebarsOnTablet` to half of it on a tablet, `mermaidViewer` (on by
default) draws mermaid blocks with the plugin's zoomable viewer instead of Obsidian's own,
`propertyWidgets` (on by default) draws some properties itself — a wallet's balance, sums in
number fields, file cards for File and Files properties and `cover` — `rememberNotePlaces` (on
by default) opens each note at the scroll and cursor it was left at on that device, unless it is
opened at a place of its own, `counterProperties` lists
the property names drawn as a counter, the number with − and + beside it, while that is on —
`dateProperties` (`date`, `due`), `priorityProperties` (`priority`), `labelProperties`
(`labels`) and `groupProperties` (`groups`) the names drawn as a date stepped a day at a time, a
task priority, labels and a list of links with a button adding one of the usual groups — and
`refreshDelay` is how long the plugin waits before rebuilding what a note shows.

`headerButtons` are buttons on notes, each `{ id, name, icon, runs, commandId, scriptName, params,
enabled, iconOnly, allNotes, noteTypes, folders, tags, otherFiles, conditions, conditionMode }`.
`runs: "command"` (what a new one is) runs `commandId`, any command id Obsidian has — a script's
is `abele:` followed by its command id — from among the icons at the top right of the note; on
a phone the third and later go into the note's more-options menu, and one whose command is not
registered (its plugin off) is hidden. `runs: "script"` (the default for an item without it)
runs `scriptName` with `params`, templates of the note's `{{title}}`, `{{path}}` and frontmatter,
from the plugin's header inside the note. Where it shows: every note with `allNotes`, else a
note of one of `noteTypes`, with one of `tags` (nested ones count, `#` optional), or under one of
`folders` (`*` is one folder, `**` any depth); then `conditions` on properties, `all` or `any`
by `conditionMode`. `otherFiles` puts a command button on PDFs, canvases, books and other
non-note files too, by folders and tags alone. They travel in a transfer, but header buttons
and automations always arrive with `enabled: false`; the person enables them locally afterwards.

`quickButton` is the floating button on a phone: `enabled` (off by default, it is a concept),
`tablet` (a tablet too), `side` (`right` or `left`), `lift` (pixels above where it rests,
dragged there by hand) and `actions`, the person's own entries at the top of its menu — each
`{ id, type, commandId, scriptName, name, icon }`, `type` being `command` or `script`. A command
entry is left out of the menu wherever the command cannot run. It travels in a transfer.

`linter` is the linter's setup: `exclude`, folders or globs no rule looks in, and `rules`, by rule
id (a built-in's, or `script:<name>`), each `{ enabled, severity, folders, exclude, types,
property, value, params }` — `severity` `error` or `warning`; `folders`/`exclude` folders or globs
(`Projects/*/Tasks`, `**/*.excalidraw.md`); `types` note types; `property`/`value` a property the
note must have, equal to the value when one is given; `params` the rule's own (for
`required-properties` a `properties` list whose entries may carry a default, `created: {{ctime}}`).
A rule with no entry runs as it ships. It travels in a transfer.

`reader` holds the book reader's settings. Among them `selectionScripts` is the book menu, the
scripts offered first on words selected in a book, in order: each `{ script, name, icon }`,
`script` being the script's `@name` and an empty `name` or `icon` meaning the script's own.
Scripts whose header says `@book` follow them without being listed; listing one gives it a place
and a name. `font` is `theme`, `serif`, `sans`, `book`, or `vault:<family>` for a family from
the fonts folder; `fontsFolder` is that folder's path (`Fonts` by default, empty for none), whose
`.ttf`, `.otf`, `.woff` and `.woff2` files are the reader's own fonts. It travels in a transfer
with the rest of `reader`; the font files themselves are vault files and go with the vault.

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
