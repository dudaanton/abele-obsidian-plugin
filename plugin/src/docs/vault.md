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
| `priority` | `low`, `medium` or `high`. Anything else, or nothing, is no priority |
| `labels` | Labels, one value or a list — `labels: [work, errands]`. The property's name is a setting (`taskLabelProperty`); read it before writing labels, it may not be `labels` |

Priority orders the task list of tasks without a date, highest first; dated tasks stay in date
order. Labels are free text: write them plainly, without a `#`. Colours for labels live in the
settings, never on the task. There is no nesting: the task's own body is its description.

Completion is `completed` being set. Do not add a `done` or `status` property.

## Calendar views in bases

A `.base` file can show the notes it finds on a calendar: a view with `type: abele-calendar`.
Its options sit in the view's own entry and all of them may be left out:

```yaml
views:
  - type: abele-calendar
    name: Calendar
    mode: month              # month, week or year — where it opens
    dateProperty: note.date  # the day a note is on
    timeProperty: note.dateTime
    endProperty: note.due    # the last day, for something that spans days
    endTimeProperty: note.dueTime
    showCalendarEvents: false  # true adds the external calendars' events
```

Left out, the four properties are the task's own, so a base over the tasks folder needs none of
them. A note goes on its date, or on its end date when that is all it has; with both it spans
the days between. A time comes from the time property or from a date written with one
(`2026-09-26T10:00`). A note with `completed` set is struck out. The base's `groupBy` colours
the notes, one colour per group. Nothing about a calendar view is stored anywhere but the
`.base` file.

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

## Skills and prompts

Notes with `type: abele-skill` or `type: abele-prompt`. A skill teaches an agent how to do
something and is loaded on demand with the `skill` tool; a prompt is a reusable piece of text
for the person to insert into a chat. Both are ordinary notes and can be edited as such.

## Chats

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
screen in the history. It is copied into the index the same way. A comment chat carries the
same fields but is not in the index, so it appears in no footer until it is opened as a full chat.
Renaming a note or a script rewrites the path in both places. Do not edit these fields by hand.

A tool result or message that showed the agent a file carries `reads`: the file's path, a hash
of its text at that moment, the time, whether it was read, attached or written by the agent, and
the lines when only a window was seen (with the file's length, so windows read one after another
add up to the whole). That is what lets `edit`, `replace` and `write` tell whether the agent has
seen a file as it is now (see the tools section). It travels with the message, so it is gone once
that message is compacted away or left on another branch.

What a chat's tools changed in the vault is not in the chat file. It is kept in the plugin's
folder, under `rewind/`, one folder per chat named by the id of its first message: `log.json`
lists every change with the user message whose turn made it, the text a file had before (or
that it did not exist, or where it was moved to) and a fingerprint of what it held after; a
picture or other binary it replaced sits beside the log as `<fingerprint>.bin`, unless it was
larger than 20MB. This is on the device where the chat ran, nothing more. It is kept under the
size the **Rewind space** setting allows (100MB by default; 0 keeps nothing): the chats written
to least recently lose theirs first, then the oldest changes of the chat being written. A change
that has been put back leaves the log. Deleting this folder only takes away the way back.

A tool result too long to send whole carries `stored`: its key and the whole text. The model was
sent only the start of it; `read_result` reads the rest by that key, for as long as the chat file
holds the message — compaction and closing the chat included.

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
conversation nor editing a message changes — an edit starts a new branch and leaves the old
message where it was — so an anchor stays put; if its words no longer read the same, its icon sits
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

## Calendar cache

The events last read from each external calendar (**Settings → Calendars**) are kept in
`calendars-cache.json` in the plugin's own folder, on this device only: per calendar, when it was
read, the version tag its server gave, and every occurrence from a month back to half a year
ahead — title, start and end, place, description, link and the people invited. It is what the
lists show before the network answers and when it does not. Nothing in a note depends on it, so
it can be deleted at any time; the next read writes it again. The links and passwords are not in
it — they are keys, in the keychain.

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
when it was read, in milliseconds. Every device writes that file and keeps the latest `at` for each
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

The open book redraws whatever the note holds as soon as it changes, so adding, recolouring or
removing a highlight by editing the note is fine; keep the shape above or the reader will not see
it. To highlight words, prefer `book_highlight`: it finds the exact place (a CFI a hand-written
link rarely gets right) and writes the callout where the settings send it, template included.

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
`|400x300` for a box; the handle at the embed's corner writes it there. To show a part of it, put
the embed in a callout of type `drawing` whose metadata is the part, `x y width height` in the
drawing's units; without it the whole drawing shows:

```markdown
> [!drawing|120 40 800 500]
> ![[Drawings/Sketch.svg|600]]
```

One drawing may be embedded several times in a note, each with its own part and size. Do not
write a drawing's file yourself — the picture and the data must agree, and only the drawing tab
keeps them so.
