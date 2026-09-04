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
template is deliberately not applied.

## Finance and time

`accountsFolder`, `financeCategoriesFolder`, `transactionPathTemplate` and
`transactionTemplatePath` decide where a new transaction and its account land and what they are
made from. `defaultCurrency` and `pinnedCurrencies` are what the finance sidebar shows first.
`timeEntryPathTemplate` is where a time entry is written; `timeTrackableNoteTypes` and
`timeTrackAllNotes` decide which notes get the timer button in their header.

## The agent

Everything under `ai.`. `ai.enabled` is the whole feature. `ai.providers` are the model
providers with their models; `ai.activeProviderId` and `ai.activeModelId` are the ones a new
chat starts on, and `ai.auxiliaryModelId` is the background model that writes titles, recaps
and compactions. `ai.agents` are the agents themselves — each with its own prompt, scope, tools
and model — and `ai.defaultAgentId` is the one a new chat opens with. `ai.commentAgentId` is
the agent a comment starts on, and `ai.commentFolder` and `ai.chatFolder` are where comments
and chats are written.

`ai.permissionMode` and `ai.toolModes` are permissions: the first decides whether writes are
confirmed, and the second holds one mode per tool — `off`, `ask` or `auto`. `ai.defaultScope`
and `ai.defaultFullVaultAccess` are what a chat may reach when its agent says nothing. Changing
any of these changes what an agent — including the one being asked — is allowed to do, so it is
the last thing to change quietly.

`ai.prompts` holds the built-in prompts: `system`, `titleGeneration`, `recapPrompt`,
`compactPrompt` and `toolDescriptions`, the last of which overrides what a tool tells the model
about itself. `ai.scriptsEnabled` and `ai.scriptsFolder` are the script feature; `ai.voice` is
dictation — which model transcribes and where its key lives.

## Everything else

`snippetsFolder` is where CSS snippets are written, `links` and `headerButtons` are the buttons
and links added to note headers, `fullWidthSidebars` widens the sidebars, and `refreshDelay` is
how long the plugin waits before rebuilding what a note shows.
