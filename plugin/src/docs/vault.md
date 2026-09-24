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
included**, so take the numbers from `read` with `line_numbers: true` (or `start_line` and
`end_line`) rather than counting by eye. Give the link a label saying what is there. A range
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
| `priority` | `low`, `medium` or `high`. Anything else, or nothing, is no priority |
| `labels` | Labels, one value or a list — `labels: [work, errands]`. The property's name is a setting (`taskLabelProperty`); read it before writing labels, it may not be `labels` |

Priority orders the task list of tasks without a date, highest first; dated tasks stay in date
order. Labels are free text: write them plainly, without a `#`. Colours for labels live in the
settings, never on the task. There is no nesting: the task's own body is its description.

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

## Any note: description and cover

Two optional properties on any note. The backlinks at the foot of a note are cards, and a
note that has these shows them on its card; a script's `noteInfo` returns the cover too.

| Property | Meaning |
|---|---|
| `description` | One or two sentences on what the note is; a card shows the first two lines |
| `cover` | A picture: `"[[poster.jpg]]"`, a vault path, or a web address. Shown as a thumbnail |

Worth filling on notes that are linked from many places — a person, a place, a film — so the
list of backlinks says what each one is without opening it.

## Skills and prompts

Notes with `type: abele-skill` or `type: abele-prompt`. A skill teaches an agent how to do
something and is loaded on demand with the `skill` tool; a prompt is a reusable piece of text
for the person to insert into a chat. Both are ordinary notes and can be edited as such.

## Chats

Chats are `.abchat` files under the chat folder, one JSON record per line. Besides the
conversation, a chat's metadata record remembers what it *did*: `touched` lists the notes it
wrote to — created, edited, replaced, moved or copied into place, never merely read — each with
the time it was last written, and `recap` is a one-sentence summary of the work, written by the
background model after a turn that wrote something. Both are copied into the chat index in the
plugin's settings, which is what draws the **Chats** list under a note: one card per chat that
changed it, with its title, its recap and the date it was changed. `summary` is a sentence or two on
what the chat is about, shown under its title in the chat history; the background model writes
it from the text the person and the agent exchanged — never from what a tool returned — after
the first turn and again as the chat grows, and for an older chat when its card first comes on
screen in the history. It is copied into the index the same way. A comment chat carries the
same fields but is not in the index, so it appears in no footer until it is opened as a full chat.
Renaming a note rewrites the path in both places. Do not edit these fields by hand.

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
the note the marker sits in. The note carries the marker and nothing else. Comment files stay
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

## Message cards

A message from a chat can be kept in a note: "Insert into note" in a message's actions writes a
fenced block at the cursor, which the plugin draws as a card with the message's text. Pressing
the card opens the chat — a comment as a comment — and scrolls to that message.

    ```abele-message
    chat: AI/Chats/Planning the trip.abchat
    message: V1StGXR8_Z5jdHi6B-myT
    ---
    The message's text, as it was when the card was made.
    ```

`chat` is the chat file's path and `message` the message's id in it; everything after `---` is
the text shown. The fence is longer than three backticks when the text holds a fence of its
own. The text is a copy: editing it changes what the card shows, not the chat. A chat renamed
since is found again by the message id and the `chat` line is corrected when the card is next
pressed. Do not invent these blocks — a `message` id that is in no chat opens nothing.

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
itself shows a markdown file's lines; a snippet of them carries `lang: md`.

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

## Places

A place is a note with its coordinates in one property, written `lat, lon` — `coordinates:
"56.9496, 24.1052"` by default, or whatever `mapCoordinatesProperty` names in this vault. The
map block accepts both `coordinates` and `location`. Five decimals is about a metre, which is
as precise as anything here needs. Obsidian's map view reads the property; an `abele-map` block
written into the note carries its own points and routes. Both are read when shown rather than
cached anywhere.

## Transfer files

Files in the vault root named `Abele transfer <date> <time>.txt` are settings on their way to
another device: one line beginning `ABL1:`, holding the settings the person ticked on the
Transfer tab, compressed and — if a key went with them — encrypted. They are not notes, they
are not content, and nothing reads them except the Transfer tab on the receiving device. Leave
them alone; the person deletes them when the transfer has landed.

## Screenshots

Every picture the `screenshot` tool takes — of a note, or of the visible part of a script view —
is written to the attachments folder as `Screenshot <what> <YYYY-MM-DD HH-mm-ss>.png`, the
same folder generated images go to. That is what lets the chat show the picture under the tool
call, so the person sees what the agent saw. They are ordinary image files: nothing reads them
back except the chat that made them, and nothing deletes them — one more each time the tool is
called. A person who does not want them keeping is the one who removes them, like any other
attachment.
