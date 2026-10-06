# Vault data

The shape of every kind of note the plugin owns: which `type` marks it, which properties it
carries, and where new ones are put. Dates are `YYYY-MM-DD` and times are `HH:mm` unless said
otherwise; a note that breaks that is a note the plugin will read wrongly.

Note frontmatter reads use `js-yaml` 4's default schema. An unquoted time such as
`time: 12:30` stays a string through property updates; leading-zero integers such as
`0755` are decimal (`755`), not legacy octal. Quote a numeric-looking value when its
exact text, including leading zeros, matters.

## Device-local template approvals

`abele-template-trust` in Obsidian's vault-scoped local storage holds template confirmations.
It extends the script trust-state schema with `templateHashes`, the SHA-256 hashes of every
explicitly confirmed template version. Identical content may reuse approval at another path;
confirming a different version never removes an earlier version's approval. The `scripts`
mapping still keeps the last reviewed hash and text per path for review diffs (text is omitted
above 100,000 characters). Existing single-version records seed the history when loaded.
For user note templates, the reviewed text includes the full file, the prepared body and the
actual output type, callbacks, path fields and target properties used at application time,
so lagging metadata cannot run unreviewed settings. Prompt templates keep the full file text.
These are explicit approvals only: existing templates, local writes and agent writes are not
implicitly trusted. No vault sidecar or setting is added. Records are not synced or included
in settings transfer, and the optional script-trust switch does not control template approvals.
Notice deduplication is session memory only and lasts only while a review notice is connected;
a dismissed notice can be shown again on the next blocked application.

## Node sessions (device-local)

Node history is owned by the daemon journal, not vault Markdown or `.abchat` files. The
plugin never runs local tools for a node tab. Obsidian's vault-scoped local storage holds
`abele-node-installation` (local namespace UUID), `abele-node-registry` (installation
registration id, label, loopback URL and pinned node identity), and the discriminated
local-chat/node-session layout in `abele-agent-tabs`. None of these travel in settings
transfer or `data.json`. Tokens use device-local keychain slots `abele-node-<registration id>`
and bypass the synced secret catalog even when it is unlocked.

Each enrollment uses its own IndexedDB database `abele-node-<local namespace>-<registration id>`,
version 1, object store `client`. Its `state` record holds pinned node/installation identity,
stream cursors, cached journal events, immutable operation outbox entries and durable receipts.
Events and cursors commit together before acknowledgment; the outbox commits before sending
and is removed only alongside a durable result. Unknown valid journal records remain cached.
Removing a connection forgets only its local preference and token; it neither deletes daemon
history nor revokes the daemon credential. Retained caches are installation-local, not encrypted
at rest, and are not canonical history. Re-enrollment uses a fresh cache namespace.

## ZIP archives

Agent `zip` stores an ordinary binary `.zip` file at the explicitly requested new path, creating
missing parents through normal vault APIs. There is no archive sidecar, new note type, settings
schema or source mutation. Entry names describe virtual archive hierarchy, not vault scope.
The successful tool result and rewind record refer to the saved output. ZIP outputs are
not added to the chat touched-file list, which still includes only Markdown and scripts;
packing does not fabricate text diffs or mark source contents as read by the model. Existing
rewind recording remains broad across concurrent operations. Failed/stopped construction saves
no partial ZIP; parents already created before a later failure may remain. See `tools` topic
**ZIP archives** for selection, permission, byte preservation and resource contracts.

## Presentations

`type: presentation` marks an ordinary Markdown note that opens as a deck. Deck frontmatter
stores `aspect` (`16:9`, `4:3`, `9:16`), optional `theme` (a vault CSS wikilink or `default`) and
optional `transition` (`none`, `fade`, `slide`). Slide markers can enable `steps` for list reveals
or override `transition`. Navigation steps and the presenter timer are ephemeral, not stored.
Standalone `---` lines split slides outside properties and code; `***` is a horizontal rule
within a slide. A slide may start with `::slide{layout=split bg="[[sample-image.png]]" dim=0.4}::`.
Region markers are `::left::`, `::right::`, and `::cell::`. Speaker reminders are ordinary
`> [!notes]` callouts retained in the note but excluded from audience rendering. Links in these
notes derive source counts and a final Sources slide in memory only; no appendix or source-count
metadata is written into the note. Fenced `css`
blocks store deck styling. `slide-script` fences store named-script parameters and refresh policy;
`slide-html` fences store HTML. Optional `htmlNetwork: true` requests interactive HTML network
permission, not an approval itself. Vault-scoped device local storage keeps a boolean under
`abele-slide-network:<deck path>`; allow, deny and dismissal are remembered, do not sync or travel
in settings transfer, and a renamed deck needs a new decision. Pending decisions and activation
lifetimes are ephemeral. Nothing is written to a side file. Agent deck edits keep this same
Markdown format; fit reports are transient. A slide `screenshot` stores a PNG in the ordinary
attachments folder and includes its path in the tool result, as other agent images do. It does
not change slide source or device-local network consent. See `slides` for the full codec.

## Canvas diagrams

Diagrams stay ordinary JSON Canvas `.canvas` files, with `nodes` and `edges`. There is no sidecar.
Only standard node `type` values are written: `text`, `file`, `link`, `group`. A semantic shape is
still a text node. Shapes use Advanced Canvas `styleAttributes.shape`: `rectangle`, `pill`,
`diamond`, `parallelogram`, `circle`, `predefined-process`, `document`, `database`. Borders use
`styleAttributes.border`; edge path/arrow styles use `styleAttributes.path` / `styleAttributes.arrow`,
with `pathfindingMethod` and floating-end fields retained. Groups retain `collapsed`; file nodes
retain `portal` and `subpath`. Standard `file` paths and text-card links follow Obsidian renames.

Each node/edge has a stable id; agents choose meaningful ids. Native Canvas reorders elements
and keys on save, so all edits and references are by id. Unknown extension data survives Abele
parse/edit/serialize; unknown node types are refused because native Canvas drops them on save.
Abele hierarchy hints are stored as node `abele.parent` (group id, or null at the root), with
`abele.parentGeometry` anchoring the intent to the node/frame geometry that Abele wrote. Native
moves/resizes or deleted frames invalidate the hint: current containment is inferred instead,
without refusing the file. Legacy unanchored hints are trusted only while their frame still
contains the card. No read rewrites stale metadata; a later successful layout refreshes it.
Group metadata is not stored in a second membership file. Creation stores its title in `metadata.frontmatter.title`.

Other Abele-only data lives under `abele` at file/node/edge level. `abele.steps` is an ordered
list of `{id,reveal:ids[],say:string,highlight?:ids[],focus?:id|{x,y,width,height}}`. Step ids are
stable author-chosen names; referenced ids name diagram nodes/groups/edges. Reveals accumulate,
a group reveals descendants, and connections appear once both endpoints are visible. Older
steps without ids receive temporary `step-N` names, persisted on the next step-authoring write.
Unknown step extension fields are retained. Lint reports invalid steps, missing ids and overly
dense reveals (including group descendants). Ink and layout hints are retained, not authored. Do not invent new `type` values for these features. Agent changes use an atomic vault
transaction with an expected revision of the file bytes and pending native state. `canvas_read`
and successful writes return that revision; edit/layout refuse versions changed since the read,
checking again at publication. The token is not a stored canvas field or sidecar. An open native
editor receives one undo item per batch. `canvasViewer` is a transferable plugin setting,
on by default, choosing Abele for newly opened canvas leaves; the per-leaf native action keeps
that tab native until reopened in Abele. A view switch never writes the diagram. If the native
editor and stored version differ, adoption waits for native saving/reloading rather than deciding
which version to overwrite; pending edits remain in their native tab. Camera and selected step live only in the workspace
leaf state, not the `.canvas` file. `![[sample.canvas#step=N]]` and `#node=id` embeds store only
that link in the note; their pictures are transient. User PNG/SVG exports go to the ordinary
attachments folder, never beside the canvas as a sidecar. SVG exports contain a self-contained
PNG picture, not editable vector paths. `look_at_canvas` creates no export file, cache note or
diagram attachment: its PNG is an agent-message image. Source notes and local images are read only within scope.

Uncertain publication and confirmed-writing/local-acknowledgment-pending work is retained only
in the running session: proposed draft, original baseline, operation kind, and revoked-attempt
evidence. The local recovery action reviews freshly read persisted bytes separately from this
work and native unsaved data. Keep/cancel leaves it intact. Confirmed local discard removes only
that memory and its unresolved evidence, leaving source bytes and history unchanged. It does
not undo a write, acknowledge matching bytes, reconstruct missing history, or save a sidecar.
Any desired change afterward is a new ordinary edit from a fresh read. No reload/crash durability
or automatic uncertain replay is provided.

## Device-local key destinations

Obsidian's vault-scoped local storage holds `abele-key-destinations-v1`: key identifiers and
approved HTTP(S) origins, never key values. It is not exported or synced. Existing service
origins are recorded once on upgrade; a changed origin arriving elsewhere needs confirmation
on this device. Deleting or changing ordinary notes does not approve a destination.
Named keys in `ai.secrets` store `allowedOrigins`, a list of recipient HTTP(S) origins beside
the keychain identifier, not the secret value. This list travels in the stored-keys transfer
section; local destination and HTTP approvals do not.
`abele-key-http-origins-v1` holds explicitly allowed home-network HTTP origins on this device;
it contains no secrets and does not travel either. Review key destinations can manually bind a
selected saved key to a canonical scheme/host/port, even with no pending destinations. Explicitly
saving a new named key there writes its exact value through SecretStore, never ordinary settings
or local trust storage. Only its name, stable ID, keychain ID and `allowedOrigins` enter
`ai.secrets`; the existing stored-keys transfer carries that metadata and protected key.
Home-network HTTP transport exceptions are separate from per-key recipient approval: an exception
does not approve other credentials. Removing the exception blocks credential-bearing HTTP again.
Manual approval never queues or replays a script. The dialog lists named key-recipient
permissions after save/reopen. Removing one persists its removal from `allowedOrigins` and
revokes its local pair trust, without deleting the protected key or other HTTP allowances.
Basic authentication compares the decoded password exactly against protected saved values;
its username and derived Authorization/Base64 material are request-local, never new settings,
trust-cache identities or duplicate stored keys.

## Excel files

Workbooks remain ordinary binary `.xlsx` or read-only `.xlsm` attachments at their original
vault paths. Opening/reading creates no Markdown conversion, cache note, sidecar or persistent
setting. The grid indexes one sheet at a time and displays saved formula caches; it never
executes macros, external links or embedded active content. Phone views offer no hand editing.
ZIP limits and strict lexical XML parsing are shared with Word. `.xls` is not supported.
Value/formula edits patch only affected cell spans (adding rows/cells in coordinate order).
Shared groups touched by an edit become ordinary formulas with translated relative references.
Unknown cell metadata survives; unrelated XML and package parts retain their uncompressed bytes.
A no-op retains the exact ZIP. `calcPr` marks recalculation required, and calc-chain parts,
relationships and content-type overrides are removed together. Saves refuse conflicting external
changes and never create a Markdown intermediary. Array/data-table formulas and protected
workbooks are not edited. Local recalculation patches `v` caches and cell type attributes on
formula cells, including other sheets' dependents. Formula XML and unknown metadata survive.
Excel ST_Xstring escapes are decoded once and escaped when writing literal escape-looking
text or carriage returns. Shared whole-row/whole-column references are translated too;
unsupported shared references remain viewable but cannot be unshared. Row span hints and used
range dimensions expand when needed. Trailing row changes never shift existing addresses;
row deletion refuses formulas/structural references rather than attempting a lossy rewrite.
The size cap is checked before reading a vault attachment and again before saving, so an edit
cannot create a file too large to reopen. No calculation engine state is persisted; `calcPr` still requests the spreadsheet app's native
recalculation. Engine-only cycle errors are stored as Excel-compatible `#REF!`, not nonstandard
error tokens. Cell formatting appends styles to the existing stylesheet (fonts, fills, custom
number formats and `cellXfs`); original records are retained verbatim. Cells are patched only
at `s` attributes. If a workbook has no stylesheet, a new part, workbook relationship and
content-type override are created together. Formatting does not touch formula caches.

## Word files

Word documents remain ordinary binary `.docx` attachments at their original vault paths.
Opening and reading creates no Markdown conversion, cache note or persistent document setting.
The Word view displays a disposable rendering of the package; it does not rewrite the file.
All parts are inflated through small input chunks with actual per-part/aggregate byte limits.
The preview receives a rebuilt archive of those validated bytes, never an unchecked original ZIP.
Large packages use a paged text view. External relationships and active HTML chunks are omitted
from the rendering only, not removed from the original document. Text edits patch only affected
`w:t` lexical spans in `word/document.xml`; untouched XML/ZIP parts are retained as their original
uncompressed bytes. A no-op retains the exact original ZIP. Edited packages are re-compressed,
so ZIP container bytes may differ; no Markdown intermediary is written. Immediately before the
binary write, the current bytes are compared with the edit's original bytes; a difference refuses
the write. A read-back immediately after publication checks the prepared result. A different
version reports a conflict and asks the person to reopen rather than claiming success.
The tiny race between the final check and publication remains, as for other vault writes;
in-place editing remains enabled. With agent rewind enabled, the prepared original is retained
in that chat's existing rewind history, including Word archives above the generic 20MB blob cap.
Formatting and structure edits patch only their selected XML nodes. New lists may add
`word/numbering.xml` plus its relationship and content-type entry; new links append relationships.
Inline images imported from the vault are embedded under `word/media/abele-image-N.ext`, with
relationships and content types. The source vault attachment is not moved or removed. Replacing
or deleting an inline image removes/changes its drawing reference; original media and unused
relationships remain in the package, since unsupported parts may still reference them.
There is no new persistent editor setting or sidecar. Phone views do not offer hand editing.


## Imported images

Images imported through Abele's chat, gallery, file importer and media downloads are stored
as vault attachments. HEIC/HEIF inputs become PNG only where native decoding is available
(iPhone/iPad), before allocating a collision-free filename. Converted external imports keep
only PNG; an existing vault HEIC is kept beside its new PNG copy. Without native decoding,
HEIC is kept with its original bytes: an external file is imported unchanged,
except that a HEIC/HEIF recognized only by MIME gets `.heic`/`.heif` appended to its filename
(e.g. `sample.jpg.heic`). That suffix preserves the binary type through storage and chat reloads.
An existing vault file is reused without making a duplicate. A notice explains that
conversion is available on iPhone/iPad. Chat attachments store the resulting file's vault
path, not base64 bytes or a temporary system path.

## Naming notes

A note's name cannot carry `* " \ / < > : | ?` — Obsidian refuses those itself — nor `#`, `^`,
`[` or `]`, which it will write to disk and then never link to: `[[Note#x]]` addresses a
heading, `[[Note^x]]` a block, and a bracket ends the link.

`create`, `mv` and `cp` take those characters out rather than refusing, and their reply says
what the note is really called: `Created: Notes/Weekly report.md (renamed from "# Weekly
report.md": "#" cannot be used in a name)`. **Read the path back from the reply** — linking to
the name you asked for will point at nothing. A name that cleans to one already taken is still
refused, because that is a collision rather than a typo.

The usual way this happens is deriving a name from a markdown heading and keeping the `# `.
Apostrophes, commas, ampersands and percent signs are all fine and are left alone.

## Links to lines

To point the person at particular lines of a note — in a reply or written into a note — link
the lines, not just the note. The range goes where a heading would:

```
[[Projects/Budget#L12-L18|the totals for March]]
[[Projects/Budget#L40]]
[the totals for March](Projects/Budget.md#L12-L18)
```

A click opens the note with those lines selected in the editor, or flashed in reading view;
Mod-click opens it in a new tab. Lines count from 1 over the whole file, **frontmatter
included**, exactly as `read` numbers them — take them from there rather than counting by
eye. Give the link a label saying what is there. A range
past the end of the note stops at its last line. Without the plugin the link still opens the
note, only at the top.

The person gets the same links from **Copy link to lines** on the editor's menu.

## Tasks

`type: task`. One note per task, in the tasks folder (`Tasks` by default).

| Property | Meaning |
|---|---|
| `created` | Date the task was made |
| `date` | The day it is scheduled for |
| `dateTime` | Time on that day, `HH:mm` |
| `due` | Deadline date |
| `dueTime` | Time of the deadline |
| `completed` | Date it was finished. Its presence is what "done" means |
| `recurrence` | Repeat rule, when it repeats |
| `groups` | What the task belongs to — the project, the person, the note it came out of |
| `priority` | `low`, `medium` or `high`. Anything else, or nothing, is no priority. The property's name is selected by `taskPriorityProperty` (default `priority`); read that setting before writing. `priorityProperties` only controls property widgets |
| `labels` | Labels, one value or a list — `labels: [work, errands]`. The property's name is a setting (`taskLabelProperty`); read it before writing labels, it may not be `labels` |

Priority orders the task list of tasks without a date, highest first; dated tasks stay in date
order. Labels are free text: write them plainly, without a `#`. Colours for labels live in the
settings, never on the task. There is no nesting: the task's own body is its description.

Completion is `completed` being set. Do not add a `done` or `status` property.

Completing a repeating task through its header or card creates the same next occurrence:
advance each existing `date` and `due` by `recurrence`, or calculate them from the instant of
completion when the rule says `from completion`. Missing endpoints remain absent. The copy
has no `completed` property and its subtasks are unchecked; undoing completion creates no copy.
Counted rules skip inactive periods: `every 2 weeks on Monday` advances two weeks, and
`every 2 months on 15` advances two months after the current month's 15th.

## Inline checklists

An inline checklist is Markdown in a note's body, not a `type: task` note. Do not create a
separate task note merely to track a list item. Preserve the list's text, indentation and
links when editing a marker with the normal note read/edit tools.

| Marker | Meaning | Open | Done |
|---|---|---|---|
| `[ ]` | Open | yes | no |
| `[/]` | In progress | yes | no |
| `[x]` or `[X]` | Done | no | yes |
| `[-]` | Cancelled | no | no |
| `[>]` | Forwarded | yes | no |
| `[<]` | Scheduled | yes | no |
| `[?]` | Question | yes | no |
| `[!]` | Important | yes | no |

Write `- [/] Sample item` while it is in progress and `- [x] Sample item` once it is done.
Cancellation is not completion. When reporting progress, keep cancelled items separate from
both done and open items. Do not treat every non-space marker as done, even though Obsidian's
rendered HTML can mark it `checked`. Leave unknown theme-specific markers unchanged.

The note tools and scripts read/write these markers as ordinary Markdown; there is no
checklist-item API or automatic inline progress counter. `read_tasks` and the task-note
lists still deal with task notes and their `completed` property, not these list items.
Repeating task notes reset completed `[x]` items in their body as before; alternate markers
are retained. The special `- [ ] [[task-note]]` embed remains a task-note widget, not a new
inline state control.

Reading view and Live Preview draw each state distinctly. A checkbox's context menu (hold
on mobile) chooses a state, and **Cycle checkbox state** cycles the editor's current list
line. Normal clicks keep Obsidian's toggle. Neither action edits fenced code examples.

## Calendar views in bases

A `.base` file can show the notes it finds on a calendar: a view with `type: abele-calendar`.
Its options sit in the view's own entry and all of them may be left out:

```yaml
views:
  - type: abele-calendar
    name: Calendar
    mode: month              # month, week, year or life — where it opens
    dateProperty: note.date  # the day a note is on
    timeProperty: note.dateTime
    endProperty: note.due    # the last day, for something that spans days
    endTimeProperty: note.dueTime
    showCalendarEvents: false  # true adds the external calendars' events
    doneLast: true           # false lists done tasks where the sort puts them
    lifeExpectancy: 90       # years the life layout draws; left out, the plugin setting
```

Left out, the four properties are the task's own, so a base over the tasks folder needs none of
them. A note goes on its date, or on its end date when that is all it has; with both it spans
the days between. A time comes from the time property or from a date written with one
(`2026-09-26T10:00`). A note with `completed` set is struck out. The base's `groupBy` colours
the notes, one colour per group, and its `sort` orders the notes within each day, done tasks after the rest unless `doneLast`
is false. Nothing about a
calendar view is stored anywhere but the `.base` file — except what the `life` layout counts
from: a life in weeks, a row per year of age and 52 weeks to a row, starts at the person's
`birthDate` in the plugin settings and runs to `lifeExpectancy` years, both shared by every base.
A row starts on a birthday, so its weeks are counted from there, not from Monday; the last week
of each row takes the day or two a year has over 52 weeks. Each week is tinted by how many of the
base's notes fall in it.

A base can also draw its notes on a timeline of history, `type: abele-timeline`, read from dates
written as text (`490 до н.э.`, `XVI век`, `ок. 1450`) — see the `history` section.

Dragging a note on the calendar writes into that note's frontmatter: every date property it
has (start and end) moves by the same number of days, and dropped on an hour its time is set,
an end time on the same day moving with it. A time goes where the note already keeps it, in
the date value or in the time property. Formula dates are never written.

## Transactions

`type: transaction`. One note per transaction.

| Property | Meaning |
|---|---|
| `date` | When it happened |
| `from` | Wikilink to the account it left |
| `to` | Wikilink to the account it went to |
| `amount` | Number |
| `currency` | Currency code |
| `foreignAmount`, `foreignCurrency` | The same sum in a second currency, for multi-currency |
| `category` | Wikilink to a category note |
| `groups` | Anything the transaction relates to — a trip, a project, a person |

Whether a transaction counts as income, spending or a neutral transfer is decided by the
*types of the accounts on each side*, never by the sign of the amount. Amounts are positive.

## Accounts

Account notes are what `from` and `to` point at. An account's `type` is one of `asset`,
`revenue`, `expense`, `liability`, `computed`. Money moving from a `revenue` account to an
`asset` account is income; `asset` to `expense` is spending; `asset` to `asset` is a transfer
and changes no balance.

## Time entries

`type: time-entry`. One note per tracked stretch.

| Property | Meaning |
|---|---|
| `start` | Start, date and time |
| `end` | End, date and time. Absent or null means the timer is still running |
| `groups` | What the time was spent on |

Totals roll up through `groups`: time tracked against a task also counts towards the project
that task belongs to, and so on up.

## Journals

Journals are configured sets of dated notes — a daily note, a monthly one, a health diary —
each with its own path template such as `Journals/{{date:YYYY}}/{{date}}`. A journal note is
found by its date and path, not by a property, so creating one by hand in the wrong place
makes a second note for that day that nothing will find. Use the journal commands.

## Logs

A log is a piece of writing that shows up in the notes it mentions. Two kinds:

- **A paragraph** inside a note whose `type` is in the log types list (`journal`, `log`,
  `daily` by default). Every wikilink in that paragraph makes it appear in that note's timeline.
- **A whole note**, when it points at something through `groups` rather than in its body. This
  is how a meeting report is written.

So a line in a daily note mentioning `[[John]]` and `[[Coffee House]]` appears, dated, on both
of those notes. That is the plugin's central idea: write once, in the place you are writing,
and read it from every relevant context.

## Any note: description and cover

Two optional properties on any note. The backlinks at the foot of a note are cards, and a
note that has these shows them on its card; a script's `noteInfo` returns the cover too.

| Property | Meaning |
|---|---|
| `description` | One or two sentences on what the note is; a card shows the first two lines |
| `cover` | A picture: `"[[poster.jpg]]"`, a vault path, or a web address. Shown as a thumbnail |

Worth filling on notes that are linked from many places — a person, a place, a film — so the
list of backlinks says what each one is without opening it.

## Files in properties

A property can hold a file of the vault. Obsidian's **File** type is one file, and the plugin
adds **Files**, a list of them; the type is chosen per property name, the way Obsidian keeps any
type (`.obsidian/types.json`). While the plugin draws properties, `file` is a File and `files` a
Files property unless another type was chosen for them, so those two names need no type picked. Write the value as a wikilink with the extension, so Obsidian keeps
it up to date when the file moves: `file: "[[Books/Dune.epub]]"`, `files: ["[[a.pdf]]",
"[[b.png]]"]`. A bare vault path is read too. The plugin draws these, and `cover`, as cards with
the file's picture; the value stays plain frontmatter, and without the plugin a Files property
shows as a raw list.

## Counters

A property named in the `counterProperties` setting is a counter: the plugin draws it with − and
+ beside the number. Its value is a plain number, `reps: 12`; empty or missing counts as 0, so the
first + writes 1. Write a number, never text, into one; a value that is not a number is shown as
it is and the buttons leave it alone.

## Dates, priorities, labels and groups

Properties named in `dateProperties` (by default `date`, `due`) are drawn with a day back, a day
on, how far away the day is and a button to its daily note. A step keeps the shape: `2026-05-01`
stays a date, `2026-05-01T09:30` keeps its time. An empty one counts as today.

Those in `priorityProperties` (`priority`) take `low`, `medium` or `high`, raised and lowered a
step at a time; lowering `low` empties it. Those in `labelProperties` (`labels`) are a list,
`labels: [work, errands]`, added to from the labels the vault already uses. Those in
`groupProperties` (`groups`) are a list of links, `groups: ["[[Garden]]"]`, edited as any list
of links, with a button adding one of the notes already used as groups; any note, or one not
written yet, can be a group, a new one is written as a plain `[[link]]` and the others are kept
as they were. Write these values in those shapes; a value the
drawing cannot read is shown as it is and left alone.

## Skills and prompts

Notes with `type: abele-skill` or `type: abele-prompt`. A skill teaches an agent how to do
something and is loaded on demand with the `skill` tool; a prompt is a reusable piece of text
for the person to insert into a chat. Both are ordinary notes and can be edited as such.
Skills are offered from the configured `ai.skillsFolder` or the calling chat's scope; loading
another asks first. The folder choice is saved with AI general settings and travels on transfer.

## Chats

Agent definitions keep `toolDiscovery`: `all` (the default, also when absent) or `by-group`.
This setting travels with the whole agent definition in settings transfer. Chat metadata
keeps `revealedToolGroups`, the group names in the order revealed with `enable_tools`.
These are discovery state, not permissions; every request still filters tools by the current
agent's and chat's settings. Reopening keeps this order; starting a new chat clears it.
Do not edit these records by hand.

Chats are `.abchat` files under the chat folder, one JSON record per line. While one is being
rewritten whole, a copy of the new content sits in the plugin's folder under `chat-backups/`, on
this device only, and goes once the file is written; a file found cut short by a crash is put
back from it. Besides the
conversation, a chat's metadata record remembers what it *did*: `touched` lists the notes it
is linked to — the ones it wrote to (created, edited, replaced, moved or copied into place,
never merely read), each with the time it was last written, and the ones the person attached it
to by hand, each with the time it was attached. The two are the same entry and look the same;
detaching a chat from a note removes its entry either way, and a later write links it again.
Scripts — `.js` files under the scripts folder — are linked the same way, `create_script`
included, and list their chats under the code when opened; no other file is linked.
`recap` is a one-sentence summary of the work, written by the background model after a turn
that wrote something. Both are copied into the chat index in the plugin's settings, which is
what draws the **Chats** list under a note: one card per linked chat, with its title, its recap
(or, for a chat that never wrote, its summary) and the date of the link. `summary` is a sentence or two on
what the chat is about, shown under its title in the chat history; the background model writes
it from the text the person and the agent exchanged — never from what a tool returned — after
the first turn and again as the chat grows, and for an older chat when its card first comes on
screen in the history. It is copied into the index the same way. The history's first/last
message dates are cached from sent user and assistant turns only: system dividers, tool records
and drafts do not move a chat. Cached dates are versioned and rebuilt once when their derivation
changes. When no turn has a date, the last-message order uses the chat's stored creation date,
or leaves its date unknown, never a file time or the current time. The creation-date order can
use the file's creation time when neither a first turn nor a stored creation date is known. A comment chat carries the
same fields but is not in the index, so it appears in no footer until it is opened as a full chat.
Renaming a note or a script rewrites the path in both places. Do not edit these fields by hand.

Unsent messages waiting behind an active turn are stored in the chat metadata as
`queuedMessages`: each has an `id`, `content`, and optional `attachments` containing vault
paths, exactly as in a normal user bubble. Imported media stays in the ordinary attachment
folder, never as binary data in settings. Enqueuing saves immediately; consumption, editing
and cancellation update the chat's queue. Reopening restores the queue without starting a
request; the user can return a message to the composer and send it again. Cancelling a queued
message removes only its reference, not the referenced vault file.

A `current_location` tool answer contains personal coordinates, accuracy, acquisition time and
the answering platform. Like other tool answers it is sent to the model and retained in the
chat file; it is not saved as a note property or a global location setting. Background recap
and compaction redact this tool-result content before sending their transcript to the helper
model; the original chat record is retained. The map's **Show my
location** action keeps its position only in the live map and discards it when the map is closed.

A chat that chose its own interceptor rather than following its agent's keeps the choice in its
metadata: `interceptorAgentId` and `interceptorContextDepth` for a reviewing agent,
`interceptorScript` for a script, `interceptorPattern` for the messages it is shown, and
`interceptorReplyOnly` for either kind. `interceptorReplyOnly: true` sends the message at once
while the agent reviewer or script may answer beside it; absent or false keeps draft review
or the script's blocking decision. The reply is stored on the reviewed message in
`interceptorChat`, with `interceptorName` and `interceptorCollapsed`, not as an assistant turn
in the main conversation. A script's side reply also has `interceptorScript: true`; ignored
rewrites, holds and tool policies, or failures and timeouts, leave notes in `interceptorChat`.
Following the agent stores no interceptor override. Agent definitions in the plugin's settings also
hold `interceptorReplyOnly` (false by default), and it travels with the agent in settings transfer. A message a
script held back, or one it was stopped on, stays in the chat as a draft (`draft: true`,
`interceptorScript: true`), with the script's lines beside it in `interceptorChat`; so do the
lines a script left on a message it rewrote or failed on.

A tool result or message that showed the agent a file carries `reads`: the file's path, a hash
of its text at that moment, the time, whether it was read, attached or written by the agent, and
the lines when only a window was seen (with the file's length, so windows read one after another
add up to the whole). Bounded deck source reads instead carry `chars` (1-based inclusive UTF-16
source character range) and `totalChars`; character and line ranges are never combined. Once
contiguous reads cover the full current file the range is absent. That is what lets
`edit`, `replace`, `write` and `deck_edit` tell whether the agent has
seen a file as it is now (see the tools section). It travels with the message, so it is gone once
that message is compacted away or left on another branch.

Automatic compaction can run between model requests within a tool loop. The summary marker is
followed by copies of the latest complete tool-call exchange and its injected messages, or the
new user messages waiting for a reply. These retained `int` records keep their content, `reads`
and `stored` data, but their `chatMessageId` names the compaction divider. Older records remain
in the log for earlier branches: selecting a branch before the divider does not include the
retained copies. Only the summary and its following records are sent on the compacted branch.
Reviewed corrections are projected separately from their source replies: they do not define
which model turn has finished and are not copied into the retained exchange under the divider's
id. Their empty `model` identifies a correction rather than a new provider reply, including
corrections materialized in the log for older clients.

What a chat's tools changed in the vault is not in the chat file. It is kept in the plugin's
folder, under `rewind/`, one folder per chat named by the id of its first message: `log.json`
lists every change with the user message whose turn made it, the text a file had before (or
that it did not exist, or where it was moved to) and a fingerprint of what it held after; a
picture or other binary it replaced sits beside the log as `<fingerprint>.bin`, unless it was
larger than 20MB. Explicitly prepared Word edits keep their original archive even above that
opportunistic cap, under the same configured history budget. This is on the device where the
chat ran, nothing more. It is kept under the
size the **Rewind space** setting allows (100MB by default; 0 keeps nothing): the chats written
to least recently lose theirs first, then the oldest changes of the chat being written. A change
that has been put back leaves the log. Deleting this folder only takes away the way back.

A tool result too long to send whole carries `stored`: its key and the whole text. The model was
sent only the start of it; `read_result` reads the rest by that key, for as long as the chat file
holds the message — compaction and closing the chat included.

## Reply highlights and revisions

Assistant `msg` records may carry `highlights`: entries with `id`, `quote` (rendered text),
`start` (UTF-16 offset in that rendered text), and `color` (yellow, green, blue, pink, purple,
or orange). They are owner annotations, not markdown inserted in `content`. They travel in the
chat file and survive reopen and file sync. Provider history does not include their colours or
turn them into instructions or emphasis. A highlight whose exact anchor no longer matches is
not relocated to another occurrence; its removal remains available in the message actions.

A comment tool-call `msg` may carry `replyProposal`: `id`, `parent` (chat path), `message` (parent
reply id), `before` (expected full source), `from` and `old` (verified source passage), `text`
(replacement markdown), `request` (owner message), `author`, `at` (epoch milliseconds), and
`status` (`pending`, `accepted`, or `rejected`). A pending proposal changes nothing in the parent.
Only the owner's diff acceptance applies it, with a stale-source check. Tool permission modes
never bypass that decision. Acceptance is written to the comment file first with `application:
"pending"`; only then is the parent changed. A completed application records `application:
"done"`. If either later write fails, the accepted proposal can be resumed idempotently via
**Finish accepted revision**, not rejected; undo belongs to the parent reply. A stale externally
rejected comment or failed initial decision write never changes the parent.

An accepted parent reply keeps its id and timestamp, replaces `content`, and appends a
`revisions` entry: `proposal`, `before`, `after`, `author`, `at`, and the previous `highlights`.
Rendered annotations are retained with the previous version, not guessed onto changed text.
Undo restores that version and its highlights, marking the revision with `undoneAt`. The oldest
`before` remains the original. These fields survive log compaction and file sync. Accepted revisions and undo also update linked assistant `int` text in the same parent-file
write, retaining tool and reasoning blocks. If compaction omitted that reply, an assistant
correction is stored after the summary, linked to the reply id. Corrections never elevate reply
text into a system message. This keeps provider history consistent on older v2 clients too;
the original remains in `revisions`, not the active provider transcript. Normal turns still
append internal records. Do not edit these records by hand.

## Comments

A comment chat is a conversation anchored to one place in a note. The anchor is a marker
written into the note's own text:

    The passage somebody asked about%%c:k7d2ph%%
    The same passage with two chats on it%%c:k7d2ph,3mq0xa%%
    A comment on a position rather than on any text:%%c:v9s1bn%%

`%%c:`, then one or more ids separated by commas, then `%%`. An id is six characters of
`[a-z0-9]`. The marker sits immediately after the passage it is about. Whether it quotes
anything depends on how the comment was made, not on what precedes the marker: one made with a
selection quotes that passage, one made without quotes nothing and marks a position instead.
Markers inside fenced code, inline code and frontmatter are not markers.

A marker is never written into the middle of a construct that a dozen characters would break: a
`[[link]]` or `![[embed]]`, a `[text](url)` link, inline code, a `==highlight==`, a `[^1]`
footnote reference, a callout's `[!type]` or a task's `[ ]` box. A comment made on a selection
that ended halfway through one of those is anchored after the end of it instead, and its quote
reaches that far as well. A fence, frontmatter, any line of a table and a callout's title line
have no such end, and a comment there is refused rather than written — the last two are drawn
by widgets of Obsidian's own, which swallow a marker whole and leave a comment nothing can
reach. The body lines of a callout take one normally.

**Never write, move or edit a marker.** It is an index into a file the plugin owns: an id with
no file behind it draws an icon that opens nothing, and a marker carried away from its passage
silently reattaches somebody's conversation to different text. Editing the note *around* a
marker is fine — surviving that is what it is for. To change the commented passage itself, use
`edit_selection` rather than `edit`: it moves the stored quote with the text.

Each comment is a chat file of its own at `AI/Comments/<id>.abchat` — the folder is
`commentFolder` in the settings — in the same format as any other `.abchat`. The quoted
passage lives there, as `anchor.quote` in the file's metadata, together with `anchor.note`,
the note the marker sits in. The note carries the marker and nothing else. A discussion in a
book is a comment too, anchored to the book and a place in it (`anchor.cfi`), with no marker:
the book's highlights note lists it (see Book highlights). Comment files stay
out of the chat history until somebody opens one as a full chat. Not every user turn in one was
a question: a comment may hold notes the person kept without asking anything, which no agent
has answered and which are simply part of the conversation from then on.

A comment can also be on a message inside a chat — an agent's answer or the person's own. A
message has no text of ours to put a marker in, so the chat keeps the list itself, as `comments` in its own metadata:

    "comments": [{ "id": "k7d2ph", "message": "V1StGXR8_Z5jdHi6B-myT",
                   "quote": "night train", "start": 9 }]

`message` is the message's id, `quote` the words selected as they read on screen, `start` where
they begin in its rendered text; a comment on the whole message has neither. The comment
file's `anchor` is `{ note: <the chat's path>, message, quote }`. Deleting the chat deletes these
comments with it. Leave both lists to the plugin — an entry with no file behind it draws nothing,
and a file no chat lists is reachable from nowhere.

A comment is a chat, so its own messages can carry comments too, to any depth: the list is then
in the comment file's metadata, and the new comment's `anchor.note` is that comment file's path.
Following `anchor.note` upwards from any comment ends at the note or the ordinary chat where it all
started. A comment is tied to a message by the message's id, which neither compacting the
conversation nor editing a user message changes — a user edit starts a new branch and leaves
the old message where it was. An accepted reply revision changes that reply in place and keeps
its original in `revisions`; if its words no longer read the same, its icon sits
dimmed at the end of the message. Deleting a comment deletes every comment under it, at every
depth, and deleting a chat deletes the whole tree hung on it.

## Message cards

A message from a chat can be kept in a note: "Insert into note" in a message's actions writes a
fenced block at the cursor, which the plugin draws as a card with the message's text. Pressing
the card opens the chat — a comment as a comment — and scrolls to that message.

    ```abele-message
    chat: AI/Chats/Planning the trip.abchat
    message: V1StGXR8_Z5jdHi6B-myT
    title: Planning the trip
    date: 2026-09-23 14:05
    ---
    The message's text, as it was when the card was made.
    ```

`chat` is the chat file's path and `message` the message's id in it, always the first two lines
and in that order; everything after `---` is the text shown. `title` (the chat's title when the
card was made) and `date` (when the message was written, local time) are optional: the card
shows the chat's current title when the chat history has one, then `title`, then the file name,
with the date under it. The card's delete icon removes the whole block from the note. The fence is longer than three backticks when the text holds a fence of its
own. The text is a copy: editing it changes what the card shows, not the chat. A chat renamed
since is found again by the message id and the `chat` line is corrected when the card is next
pressed. Do not invent these blocks — a `message` id that is in no chat opens nothing.

## Saved key identity

Named saved keys in `ai.secrets` carry a stable `id` independent of their editable `name` and
keychain reference `keyId`. Older records acquire identities at settings load, persisted by
migration without changing keychain references. A legacy keychain reference is sufficient
when unique; labels distinguish older aliases of the same key, with a suffix for duplicate
records. Unsaved new records acquire an identity before editing. Settings transfer carries
each saved-key record separately by this identity, and `ai.autoRetry` travels in AI general
settings. Incoming settings cannot move an open key editor onto another record.

## Model request timeout

`ai.requestTimeoutSeconds` stores the shared chat-model timeout in seconds, defaulting to 60.
Values from 1 to 3600 are accepted; absent or invalid values use 60. It limits connection wait,
error-body reading and each idle wait for a streamed chunk, not the whole response. It applies
to all OpenAI-compatible chat models, including background, review, fallback and delegated
requests, and travels in the AI general settings section. Other request types keep their own
limits.

## Background model settings

The shared `ai.auxiliaryModelId` setting stores `providerId::modelId` for new background-model
selections, so providers offering the same model name remain distinct. Older bare model IDs
are still read by searching providers in their configured order. An agent's own background
provider/model pair takes precedence, and an empty global selection follows the chat's model.

## GitHub connection settings

The plugin's `github.connections` list in settings holds stable connection IDs, names, server
addresses, repository-owner patterns, per-server default marks, and optional account metadata
(discovered login, avatar URL and access-check time). Each `keyId` names a keychain slot, never
contains the token. A migrated connection keeps the old `github.keyId` slot; the old `keyId` and
`server` fields are retained as a single-server compatibility projection. An explicitly empty
list does not reimport an old token. Connection entries can be selected individually in settings
transfer; keys travel only when the transfer includes keys. The separate notifications credential
is still part of the GitHub general settings block. Its `boundKeyId` and `boundServer` retain
its original server when the projected default moves to another host; the old-version
`notifications.keyId` is blanked if the old plugin would send it to the wrong host. Deleting a
connection forgets its local keychain slot, not the encrypted shared copy another device may
still use; unused shared keys can be revoked deliberately in the synced-key catalog.

Repository trees, downloaded search indexes and pending builds use an opaque credential
generation, not a host/repository-only key. These are session memory, never settings or note
files. Token replacement, server edits, connection removal and key-store lock changes retire
the previous generation; a retired request cannot publish a late result. GitHub workspace tab
state also holds `connectionId` and `connectionIntent` (automatic or manual) beside its URL.
Account-only navigation adds a history entry. Successful repository routing lives in session
memory; item refusals expire after roughly ten minutes. Manual owner preferences live only in
connections' `owners` lists. An agent opening a tab may attach a runtime-only allowed-connection
restriction; it is not persisted as permission granted by the person. Each stored agent may
hold `githubConnections`, a map from stable connection IDs to `off`, `ask` or `auto` (shown as
Off, Ask, On). A missing ID means Off. New agents store an empty map. Saved agents lacking
the entire map migrate once: only the original `github-legacy` credential receives Auto if any
GitHub tool is Auto, otherwise Ask if any is Ask; agents with all GitHub tools Off get an empty
map. An existing map is never broadened. It travels with the agent; unresolved IDs remain visible
in its Access settings until the connection arrives. One-operation approvals and executing-agent
restrictions on a tab are runtime-only, never written as persistent grants. Each Ask grant
also identifies the exact credential generation approved, not only the connection ID; token,
server, or key-store state changes invalidate it for primary and secondary tab loads.

## GitHub file tree layout

Obsidian's vault-scoped local storage holds `abele-github-tree-panel` (whether a new desktop
GitHub tab starts with the tree open) and `abele-github-tree-width` (the desktop split width in
CSS pixels, or null for the default 18em). The width is clamped to fit the current tab without
rewriting the saved preference. These are device-local UI choices, not plugin settings, synced
files or settings-transfer entries. A narrow tab keeps its drawer layout regardless of the
remembered desktop width.

## GitHub links

A GitHub tab writes plain markdown links into a note when the person asks it to — "Insert into
note" on a comment, on the item itself or on selected lines of code — at the cursor of the note
last worked in, on a line of its own:

    [acme/widgets#42 · src/app.ts:10–20](https://github.com/acme/widgets/pull/42/files#diff-<sha256 of the path>R10-R20)
    [acme/widgets#42 · comment by alice](https://github.com/acme/widgets/pull/42#issuecomment-123)
    [acme/widgets@1a2b3c4 · src/app.ts:10–20](https://github.com/acme/widgets/blob/<full commit sha>/src/app.ts#L10-L20)

The address is GitHub's own and opens the same place on GitHub; with the integration on, a click
on it opens a GitHub tab scrolled to that line or comment. The label is only text. A link to a
file is pinned to a commit, not a branch, so it keeps pointing at the lines it was made from.
Lines of a markdown file — selected in its rendered view or in its code — are linked to the
source with `?plain=1` before the anchor (`…/README.md?plain=1#L3-L7`), which is how GitHub
itself shows a markdown file's lines; a snippet of them carries `lang: md`. In a GitHub tab such
a link opens the file rendered, with the pieces holding those lines marked, unless the GitHub
setting "Markdown files open as" is Code (`github.markdownView` in the plugin's settings).

## GitHub people

The names and pictures of the people shown in GitHub tabs are kept in `github-users.json` in the
plugin's own folder, on this device only: under the server and the login, the name from the
profile (or none), the picture as a `data:` URL, and when each was read. An entry is asked for
again after a week. Nothing in a note depends on it — links and snippets name people by login —
so the file can be deleted at any time; **Settings → GitHub → Kept names and pictures → Clear**
does the same.

## External event completion

An external calendar's checkbox marks **one occurrence**, not the recurring series. It is an
owner annotation only: Abele never writes it back to ICS or CalDAV. Calendar chips, the event
menu and timeline rows can mark it done or undone; completed events follow the same completed
visibility control as tasks. The calendar view's control hides completed notes and events together.

Marks are stored in `calendarCompletion` in the plugin's `data.json`, alongside the calendar
definitions, like other shared plugin settings. Sync the plugin settings to carry them to other
devices; **Calendars** in settings transfer also carries them. They are not in the device-local
calendar cache, so deleting that cache does not clear them. Settings received from another
device replace these marks like other settings; this is not a concurrent per-occurrence merge.
Local mark edits made while an older settings read is still in flight are retained, without
reverting unrelated incoming settings or marks.

Each key is a JSON tuple `[feedId, uid, recurrenceId]`; a one-off has `null` as its last part.
Recurring occurrences use their original start (or `RECURRENCE-ID` for a detached override),
never their rescheduled start: `date:YYYY-MM-DD` for all-day events, `floating:` followed by the
source wall time for floating events, or `instant:` followed by epoch milliseconds for zoned
times. An unresolved source zone keeps `wall:` with a JSON tuple of its zone name and source
wall time instead of using a device offset. Moving an occurrence or changing the device timezone does not change the mark. A value
holds `feedId` and `seenAt`, the last successful observation or tick time in epoch milliseconds.
No event title, description, link or calendar credential is stored in a mark.

On successful calendar reads, marked occurrences still present renew that observation at most
once a day. Marks absent from the expanded window for **180 days** are removed, including old
occurrences that have fallen out of the window and marks of removed calendars. A failing feed
does not prune its marks, and a disabled feed retains them until read again. Unticking removes
the mark immediately. Legacy event-only caches are refreshed before ticking, so missing
occurrence identity can never accidentally mark a whole series. If a detached override's old
ID changes during that refresh, its feed, UID and displayed start must identify exactly one
refreshed occurrence. Ambiguous matches or an occurrence moved again since caching require a
fresh tick on the updated row instead of guessing which occurrence to mark.

## Calendar cache

The events last read from each external calendar (**Settings → Calendars**) are kept in
`calendars-cache.json` in the plugin's own folder, on this device only: per calendar, when it was
read, the version tag its server gave, and every occurrence from a month back to half a year
ahead — title, start and end, place, description, link and the people invited. It is what the
lists show before the network answers and when it does not. Nothing in a note depends on it, so
it can be deleted at any time; the next read writes it again. The links and passwords are not in
it — they are keys, in the keychain. Cache version 2 identifies credentials only by a
per-key generation number, not a password or secret-link checksum. The generation and its
change detector stay in the device keychain. Version 1 caches are discarded once and refreshed;
changing a credential invalidates its cached source, including a response already in flight.

## GitHub snippets

"Insert with code" on lines selected in a GitHub tab, and "Insert as quote" on a comment, write a
fenced block the plugin draws as a card: the label as a link to the place, then the code — or
the comment — itself.

    ```abele-github
    url: https://github.com/acme/widgets/blob/<full commit sha>/src/app.ts#L10-L12
    label: acme/widgets@1a2b3c4 · src/app.ts:10–12
    lang: ts
    start: 10
    ---
    the lines, as they were
    ```

`url` and `label` are what a copied link has. `lang` is the file's extension and picks the
highlighting. Lines of a file carry `start:`, the number of the first line. Lines of a diff
carry `diff: true` instead, and the text is unified-diff lines (` `, `-`, `+`) under an
`@@ -old +new @@` line holding the numbers of both sides. A comment carries `comment: true`, and
its text is a `**author** · date` line, a blank line, then the comment's markdown. The fence is
longer than three backticks when the text holds a fence of its own.

The text is a copy taken when the block was made: it reads without GitHub and does not follow
the repository. Editing it changes what the card shows. A block without `url`, `label` or the
`---` line is shown as plain text, as written. Do not invent these blocks: `url` must be an
address the GitHub tab can open.

## Plugin version on this device

The changelog is bundled with the plugin, not written into the vault or fetched from a
server. Obsidian local storage keeps `abele-changelog-version` with schema 1 and the last
plugin version run in this vault on this device. It is not `data.json`, a note or part of a
settings transfer. The first run with this feature sets a quiet baseline; no previous version
can be inferred from older installations. On an upgrade the new baseline is saved before
showing a dismissible notice. A downgrade records the older version silently; re-upgrading
can offer its changes again. The changelog's recovered historical boundaries use commit
dates, not claimed publication dates.

## Where notes were left

With `rememberNotePlaces` on, each device keeps, outside the vault, where every note it opened
was left: the scroll and the cursor, by path. A note opened plainly comes back there; one opened
at a heading, a block, a search result, a line or a book's highlight goes to that instead.
Nothing about it is written into notes or synced, a rename carries the place along and a delete
drops it. The local footer-view memory also keeps expanded list pages, opened task descriptions,
and whether all past timeline days were revealed (`calendarPast`). Revealed history is drawn again
before restoring a saved past-task anchor; an older saved day boundary migrates to all history open.
With place restoration off, the timeline starts at today. Search windows are not remembered.

## Places

A place is a note with its coordinates in one property, written `lat, lon` — `coordinates:
"56.9496, 24.1052"` by default, or whatever `mapCoordinatesProperty` names in this vault. The
map block accepts both `coordinates` and `location`. Five decimals is about a metre, which is
as precise as anything here needs. Obsidian's map view reads the property; an `abele-map` block
written into the note carries its own points and routes. Both are read when shown rather than
cached anywhere.

## Diagrams

A fenced ```` ```mermaid ```` block is drawn as a diagram — in notes, in the chat and in GitHub
tabs — so a flowchart, a sequence, a class, state, ER or Gantt diagram, a timeline, a pie or a
mind map is written as Mermaid source in the note rather than as a picture. The person sees it
at the width of the note and zooms, drags or opens it full screen themselves, so a large diagram
is fine: do not split one up to make it fit, and do not add `%%{init}%%` sizing for it. Leave the
theme alone too — it follows Obsidian's light or dark theme unless the source picks one. A node
given the class `internal-link` links to the note its label names. The source must parse: a
block with a syntax error shows Mermaid's error in place of the diagram. Nothing is drawn until
the person has allowed diagrams in the vault (Obsidian asks once); the block is still the right
thing to write.

## Transfer files

Files in the vault root named `Abele transfer <date> <time>.txt` are settings on their way to
another device: one line beginning `ABL1:`, holding the settings the person ticked on the
Transfer tab, compressed and — if a key went with them — encrypted. They are not notes, they
are not content, and nothing reads them except the Transfer tab on the receiving device. Leave
them alone; the person deletes them when the transfer has landed.

## Scripts from other devices

With `ai.confirmForeignScripts` on, each device keeps, outside the vault, the SHA-256 of every
version of a script it wrote or had confirmed, and runs from a button, an automation, startup or
an agent only a version it has. Nothing about it is stored in the vault: a script file is just
its text. A script the agent writes or edits with its file tools counts as written on this
device; on another device the same change waits to be confirmed there.

## Synced keys

The plugin's settings file (`data.json` in its folder under the config directory) holds, when
the person has turned synced keys on, a `secretStore`: every API key and token the plugin
holds, encrypted with AES-GCM under a key derived from a passphrase (PBKDF2-SHA-256, the salt
and iteration count stored beside it), with a check value that tells a wrong passphrase from a
damaged file. It lives in the settings file rather than a file of its own because Obsidian
Sync carries only `data.json`, `main.js`, `manifest.json` and `styles.css` out of a plugin's
folder. Without the passphrase it is unreadable. Each device keeps only the derived key, in its
own keychain.

Two devices changing keys at once are merged key by key, the later change winning, and the
store out of a Syncthing conflict copy of the settings file (`data.sync-conflict-….json`) is
merged the same way; the copy itself is left for the person to delete. Never edit the store
by hand: a single changed character makes it undecryptable on every device.

## MCP servers

The MCP servers connected in the settings are kept in the same settings file, `ai.mcpServers`:
each server's address, the headers sent to it, the name of the keychain slot holding its token
(never the token), and a copy of its tool list from the last time it was fetched — names,
descriptions and parameter schemas, as the server gave them. Nothing is written into the vault.

MCP entries in `ai.toolModes`, each agent's `toolModes`, and saved chat overrides use
`mcp:` followed by the JSON pair `[server.id, originalToolName]`. Provider-facing names are
only aliases, not permission keys. Renaming a server keeps these entries unchanged; settings
transfer carries the identities and mode maps. At upgrade, `ai.mcpLegacyToolMap` freezes each
legacy `mcp_<server>_<tool>` alias's owners as `{ serverId, toolName, serverName }` records.
Closed legacy chats use that snapshot when later opened, never the server labels at that time.
The snapshot travels with AI general settings but never replaces one already established in
the receiving vault. A legacy mode migrates only for a unique recorded owner still present;
ambiguous or removed owners become `ask`. Unmatched aliases are retained as dormant `ask`
entries under `mcp:unresolved:` followed by their JSON-encoded alias. One notice lists the
choices to set again, and the migrated chat is saved so the notice does not repeat.

Saved pending MCP calls also carry `permissionKey` and `destinationKey`, pinned from the tool
list offered in the model request. The destination is the JSON pair `["http", fullEndpointUrl]`
(HTTP is the only supported MCP transport); saved agent modes still use the server/tool identity.
Approval and execution require the current alias to select the same tool and exact endpoint. Missing tool or destination identities in older pending calls, removed tools, reassigned
aliases and changed endpoint URLs are refused with a request for a fresh call; they never select a replacement server.

## Screenshots

Every picture the `screenshot` tool takes — of a note, or of the visible part of a script view —
is written to the attachments folder as `Screenshot <what> <YYYY-MM-DD HH-mm-ss>.png`, the
same folder generated images go to. That is what lets the chat show the picture under the tool
call, so the person sees what the agent saw. They are ordinary image files: nothing reads them
back except the chat that made them, and nothing deletes them — one more each time the tool is
called. A person who does not want them keeping is the one who removes them, like any other
attachment.

## Books

Book files anywhere in the vault — `.epub`, `.mobi`, `.azw`, `.azw3`, `.fb2`, `.fbz`, `.cbz` — open
in Abele's book reader, a tab of its own; `.pdf` files
open there too when the person has chosen so, and otherwise in Obsidian's own viewer. The plugin
never changes a book or PDF file. Where each book was left is kept outside the notes, in
a JSON file in the vault — `abele-book-places.json` at its root unless the reader setting
`placesPath` says otherwise — so every device reads the same places. It maps a key to a place:
the book's `dc:identifier` as `id:<identifier>`, so renaming or moving the file keeps its place,
or `path:<path>` for a book without one; each place is `{ cfi, fraction, path, at }`, `at` being
when its position last changed, in epoch milliseconds. A normal reader open adds optional
`openedAt` (the last successful open, without changing `at`), `title` and `author` from the
book's own metadata, and `measure: { kind, count }` with `measureAt` (epoch milliseconds when
the measurement changed). Position (`at`), last opening (`openedAt`, with cached metadata),
and measurement (`measureAt`) merge independently. An incoming legacy position that omits
these optional fields does not erase them. Measurements saved before `measureAt` existed use
their recorded opening/position time as a fallback when merging; a measurement-only update
neither advances `at` nor makes the reader follow another device. `kind: 'locations'` is the engine's
whole-book text locations (roughly 1,500 bytes each) for reflowing books; `kind: 'pages'` is
its fixed-layout/PDF page count. These are **not printed-edition pages**. Older records omit
these fields; nothing reads unopened binaries to fill them. A new open before any saved CFI
may have an empty `cfi` and `at: 0`, which is not a saved position. Every device writes that file and keeps the latest `at` for each
book. A copy, `book-places.backup.json`, is written just before it in the plugin's own folder, on
this device only. Obsidian's file list does not show a `.json` file; Obsidian Sync carries it with
"Sync all other types" on. The only note written beside a book is its highlights note; a PDF with ink also has its ink folder.

Bookmarks — pages the person marked to come back to — are kept the same way, in
`abele-book-bookmarks.json` in the same folder as the places file, under the same book keys: each
key maps bookmark ids to `{ id, cfi, fraction, label, text, created, at }` — the page's CFI (a
PDF's page as `/6/<2×page>`), the chapter or page it is in, the page's first words, and when it
was made and last changed, in milliseconds. A removed one stays as `deleted: true` for 180 days, so
another device's copy does not bring it back. Every device keeps the latest `at` for each bookmark;
`book-bookmarks.backup.json` in the plugin's folder is this device's copy. The agent sees them
through `book_views` and `book_highlights` and adds or removes one with `book_bookmark`, never by
writing the file.

`.epub` and `.pdf` files can be linked at a place, like notes at lines. The place goes where a
heading would: `[[Books/Dune.epub#cfi=/6/8!/4/2,/1:0,/1:22|Chapter 3]]` (an EPUB CFI without its
`epubcfi(…)` wrapper, with `[`, `]`, `(`, `)`, `|`, `#`, `%`, `^` and spaces percent-encoded) or
`[[Papers/Paper.pdf#page=4]]` (a PDF page, from 1). A click opens the file there. Give the link a
label saying what is there, usually the chapter.

### Navigation panel width

Obsidian's vault-scoped local storage holds `abele-book-panel-width`: the reader's desktop
navigation split width in CSS pixels, or null for the default 21em. The split uses the same
12em minimum and smaller-of-40%-or-36em maximum as the GitHub file tree. A narrower tab clamps
the displayed width without rewriting the saved preference. This is a device-local UI choice,
not a plugin setting, synced file or settings-transfer entry. On narrow screens the navigation
panel remains a drawer, independent of the remembered desktop width.

### Book highlights

A book's highlights are kept, by default, in `<book name> highlights.md` beside it, with
`type: book-highlights` and `file: "[[<the book file>]]"` (a wikilink, extension included, in a
File property). Notes made before this link it as `book:` instead, which is read the same way;
leave either as it is. It is found by that property, not its name. Each highlight is one callout, in the order of the book:

```markdown
> [!quote|green] [[Books/Dune.epub#cfi=/6/8!/4/2,/1:0,/1:22|Chapter 3]]
> Fear is the mind-killer.
>
> The person's comment, after a blank quoted line.
```

- The type is always `quote`; the colour after `|` is one of `yellow`, `green`, `blue`, `pink`,
  `purple`, `orange` (none means yellow).
- The title is a link to the place (`#cfi=…`), labelled with the chapter or `Page N`.
- The first paragraph is the highlighted words as they were; after a blank `>` line, the comment.
- A highlight is told apart by its place: two callouts linking to the same CFI are one highlight.
- In reflowing EPUBs, if the saved CFI points away from the quote in an opened chapter, the reader may draw the words at a found occurrence instead. The highlight's action row offers **Repair highlight link…** only for verified mismatches. A confirmation lists one or all mismatches found in chapters opened during this reading session; it does not audit the whole book. No link is changed on detection or dismissal. On confirmation only the encoded CFI value of each selected callout title link changes; all other note bytes, including quote and comment, remain as written. Changed, duplicated or colliding locations are skipped. Repeated quotes use the nearest occurrence when the saved anchor is available, so inspect the proposed context before confirming. Other copied links and a discussion's separate saved anchor are not repaired.
- A **discussion** — a chat about the words, started with "Ask here" in the reader — is kept in the
  same note: its chat's file linked after the place in the title. Words only asked about are a
  `chat` callout with no colour; a highlight that was asked about keeps its `quote|colour`:

  ```markdown
  > [!chat] [[Books/Dune.epub#cfi=/6/8!/4/2,/1:0,/1:22|Chapter 3]] · [[AI/Comments/k7d2ph.abchat|Discussion]]
  > Fear is the mind-killer.
  ```

  The chat is a comment (see Comments): its file is `<id>.abchat` in the comments folder, with
  `anchor: { note: <the book>, quote, cfi }` — the book and the place, and no marker anywhere; the
  book is never written to. The link is how the reader finds the chat again, so leave it as it is;
  removing the callout takes the mark off the words and leaves the chat where it is.
- Other callouts, headings and paragraphs in the note are the person's and are left as they are.

**Where highlights go is a setting** (`reader.notesTo`, `notesPath`, `notesTemplate` in the
plugin's settings, and per book `reader.bookNotes[<key>]`, the key as for places): a note of the
book's own as above, or one named note several books share. In a shared note a book's highlights
are the callouts whose place link resolves to that book; a new one is added at the end, its link
labelled `<title> · <chapter>` unless a template says whose it is. A place no chapter of the
contents comes before is labelled with the book's title. Highlights written before the
choice changed stay where they are and still count while their note is the book's own or named in
the settings.

A **template** is an ordinary note in the plugin's template language. The first highlight makes
the note from all of it; after that only the part between `{{#body}}` and `{{/body}}` is added,
at the end, for each highlight. In it `{{ highlight }}` is the callout above (on a line of its
own); `{{ title }}`, `{{ author }}`, `{{ book }}` (a link to the book), `{{ chapter }}`,
`{{ color }}`, `{{ link }}` (to the place) and `{{ date }}` / `{{ date.format('…') }}` are filled in,
anything else is left as written. A template without a body gets each highlight at the end.
Removing a highlight removes the lines its body wrote around it while they still read as written.

The quote and the comment can be fields of their own: `{{ quote }}` is the callout (on a line of its
own) and `{{ comment }}` is the comment, on a line of its own with whatever the body puts around it
(`**Comment:** {{ comment }}`, `> {{ comment }}`), before the quote or after it. With that field the
callout holds the words alone and the comment is kept in the field — read from there and written
there when it changes — for as long as the lines around the callout still read as the body wrote
them; otherwise, and in notes written before, the comment is inside the callout as above. A comment
of several lines goes on the lines after the field's, each with its `>` marks if it has them;
without them its blank lines are left out, since a blank line ends it.

A highlight can also name **forms of its word to underline everywhere in the book**. With a
`{{ forms }}` field in the template's body (on a line of its own, like `{{ comment }}`), they are
kept there, comma-separated; otherwise as the callout's last line, `> forms:: māja, mājas, mājā`,
after a blank `>` line. Keep either shape when editing; an empty field or no line means none.
Set them with `book_highlight` or `book_highlight_edit` (`forms`) rather than by hand. In the note the
forms are a link: it opens the book with its search on them, every place listed. Any link to a
book can do the same: `[[Books/Novel.epub#words=māja,mājas]]`.

The open book redraws whatever the note holds as soon as it changes, so adding, recolouring or
removing a highlight by editing the note is fine; keep the shape above or the reader will not see
it. To highlight words, prefer `book_highlight`: it finds the exact place (a CFI a hand-written
link rarely gets right) and writes the callout where the settings send it, template included.

### Words underlined everywhere

A note whose properties name forms of a word is a **vocabulary rule**: the book reader underlines
each form wherever it stands as a whole word in the books the rule applies to, and a tap on one
opens the note. A translation card is the usual one:

```yaml
word-forms: [māja, mājas, mājā]
word-language: lv
word-books: ["[[Books/Novel.epub]]"]
```

- `word-forms` — a list; the note is a rule while it has one. Matched whole and case-insensitively;
  letters with a diacritic are other letters, and nothing is stemmed, so list each form.
- `word-books` — wikilinks to the books it applies to, extension included.
- `word-scope` — `book` (the default: the books listed) or `language` (every book whose language
  is `word-language`, by primary tag: `lv` matches `lv-LV`). With neither books nor the language
  scope it applies nowhere.
- `word-underline: false` — off, the forms kept.

Several rules (notes, highlights with forms) for the same word make the tap a menu. Reflowing
books and PDFs with selectable text use the same forms and properties; scanned/image-only PDF
pages need a text layer to show underlines. Other fixed-layout books are not supported. Only
single words are underlined. Language-wide rules require the book's language metadata (a PDF
without it can still use book-scoped rules). Scripts write these properties with
`vocabulary.mark`; write them by hand the same way.

### Ink on PDF pages

What is drawn on a PDF's pages (the pen under the page) is kept in the vault, never in the PDF:
one SVG per page in a folder beside the book, `<book name> ink/<book name> page <N>.svg` (N from 1).
Each file is the page's size on white paper, one `<path>` per stroke; the reader reads back only
each path's `data-tool` (`pen` or `marker`), `data-color`, `data-size` and `data-points` (`x y
pressure`, repeated, in the page's units at 100%). The page's first stroke also puts a callout into
the book's highlights note, the picture embedded, so it shows without the plugin:

```markdown
> [!ink] [[Papers/Paper.pdf#page=4|Page 4]]
> ![[Papers/Paper ink/Paper page 4.svg]]
```

A page whose last stroke is erased has its file and its callout removed. Renaming or moving the
PDF renames its ink folder and files. A change to a file from another device is drawn when it
arrives.

## Drawings

A drawing is an `.svg` file anywhere in the vault whose root element carries
`data-abele-drawing="1"`; it opens in the plugin's drawing tab, while every other SVG stays in
Obsidian's picture view. It is an ordinary picture — white paper sized to what is drawn plus a
margin, one element per item — so `![[Sketch.svg]]` shows it in a note without the plugin. What
the plugin reads back is only the JSON in `<metadata id="abele-drawing">`: `{ "v": 1, "items": [...] }`,
the items oldest (lowest) first, each with an `id` and a `type`:

- `stroke` — `tool` (`pen` or `marker`), `color`, `size`, and `d`, its points packed: the first
  `x, y, pressure` as they are (pressure in hundredths), every one after it as the step from the
  one before;
- `shape` — `kind` (`rect`, `ellipse`, `line`, `arrow`), the two corners or ends `x1 y1 x2 y2`,
  `color`, `size`;
- `text` — `x`, `y` (the top left), `text` (lines split by `\n`), `size`, `color`.
- `note` — a note shown on the drawing: `path` (the note's vault path), its box `x`, `y`, `w`, `h`,
  and `scale`, the drawing's units per pixel of the note's text. The file's picture shows it as a
  card with the note's name; the drawing's tab shows the note itself. A note renamed or moved in
  Obsidian is followed there.

Colours are names: `black`, `red`, `blue`, `green`, `yellow`, `pink`. Units are CSS pixels at
100%.

A note shows a drawing by embedding it, `![[Drawings/Sketch.svg]]`, at the drawing's own size
within the note's width and a modest height. A size is Obsidian's own for any picture, written in
the embed: `![[Drawings/Sketch.svg|400]]` for a width, the height following the drawing, or
`|400x300` for a box; the handle at the embed's corner writes it there. To show a part of it,
name the part in the link after `#part=`, `x,y,width,height` in the drawing's units; without it
the whole drawing shows. Nothing goes round the embed:

```markdown
![[Drawings/Sketch.svg#part=120,40,800,500|600]]
```

Older notes name the part in a callout of type `drawing` round the embed,
`> [!drawing|120 40 800 500]` with `> ![[Drawings/Sketch.svg]]` under it; those still show the
part, and a part changed there is kept in the callout.

One drawing may be embedded several times in a note, each with its own part and size. Do not
write a drawing's file yourself — the picture and the data must agree, and only the drawing tab
keeps them so.
