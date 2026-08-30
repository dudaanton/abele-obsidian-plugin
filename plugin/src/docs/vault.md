# Vault data

The shape of every kind of note the plugin owns: which `type` marks it, which properties it
carries, and where new ones are put. Dates are `YYYY-MM-DD` and times are `HH:mm` unless said
otherwise; a note that breaks that is a note the plugin will read wrongly.

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

A task has no priority, no tags and no nesting: that is a deliberate omission, not a gap to
fill with new properties. The task's own body is its description.

Completion is `completed` being set. Do not add a `done` or `status` property.

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

## Skills and prompts

Notes with `type: abele-skill` or `type: abele-prompt`. A skill teaches an agent how to do
something and is loaded on demand with the `skill` tool; a prompt is a reusable piece of text
for the person to insert into a chat. Both are ordinary notes and can be edited as such.

## Transfer files

Files in the vault root named `Abele transfer <date> <time>.txt` are settings on their way to
another device: one line beginning `ABL1:`, holding the settings the person ticked on the
Transfer tab, compressed and — if a key went with them — encrypted. They are not notes, they
are not content, and nothing reads them except the Transfer tab on the receiving device. Leave
them alone; the person deletes them when the transfer has landed.
