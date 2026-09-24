# Settings

What the plugin's own settings are and what each group of them decides, for `read_settings` and
`write_settings`. Paths are dotted: `tasksFolder`, `ai.chatFolder`, `ai.agents.0.name`. One
setting per write, and the new value must be of the same type as the old one — read it first.

## Reading and changing them

`read_settings` with no arguments lists every setting with its value, or with its size when it
is a list or an object. With `path` it returns that one value as JSON. `write_settings` takes a
`path` and a `value` and changes exactly that.

Three rules hold for every write. The setting has to exist already: this changes settings rather
than inventing them, and a key the plugin never reads would otherwise sit in the file for good.
The type has to match, so a folder name cannot become a list by accident. And keys and their
keychain ids are neither readable nor writable — `ai.secrets`, anything named `apiKeyId` or
`token`, and the search key. The chat index, `ai.chatHistory`, is a cache rebuilt from the
vault and is out of reach for the same reason a cache always is.

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
`timeEntryPathTemplate` is where a time entry is written; `timeTrackableNoteTypes` and
`timeTrackAllNotes` decide which notes get the timer button in their header.

## The agent

Everything under `ai.`. `ai.enabled` is the whole feature. `ai.providers` are the model
providers with their models; `ai.activeProviderId` and `ai.activeModelId` are the ones a new
chat starts on, and `ai.auxiliaryModelId` is the background model that writes titles, recaps,
summaries and compactions. `ai.agents` are the agents themselves — each with its own prompt, scope, tools
and model — and `ai.defaultAgentId` is the one a new chat opens with. `ai.commentAgentId` is
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
agent's own, added to by `remember` and edited in that agent's settings. `ai.scriptsEnabled` and
`ai.scriptsFolder` are the script feature; `ai.voice` is
dictation — which model transcribes and where its key lives.

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
`github.searchLimitMb` (100 by default) is the largest repository — its files at that commit
added up, in megabytes — that a tab's code search, go to definition or `github_grep` downloads
whole to search; a larger one is searched through GitHub's own code search instead, on the
default branch only.

## Everything else

`snippetsFolder` is where CSS snippets are written, `links` and `headerButtons` are the buttons
and links added to note headers, `fullWidthSidebars` widens the sidebars to the whole screen on
a phone and `halfWidthSidebarsOnTablet` to half of it on a tablet, `mermaidViewer` (on by
default) draws mermaid blocks with the plugin's zoomable viewer instead of Obsidian's own, and
`refreshDelay` is how long the plugin waits before rebuilding what a note shows.

A header button runs `scriptName` with `params`, and shows on notes whose `type` is in
`noteTypes`, on notes anywhere under one of `folders`, or on every note when `allNotes` is on —
task notes included. `enabled: false` keeps it configured but hidden, `iconOnly` leaves its
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
