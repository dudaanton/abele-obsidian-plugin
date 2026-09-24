# GitHub

Abele can show GitHub issues, pull requests, discussions, commits and files in tabs inside
Obsidian, so a link in a note opens the thing it points at without a trip to the browser. It
reads only: nothing is ever written to GitHub. It is off until turned on in **Settings → Abele →
GitHub**.

## What opens in a tab

| Link | Opens |
|---|---|
| `…/owner/repo/issues/12` | The issue: body, labels, state and every comment. A number that is really a pull request opens as the pull request. |
| `…/owner/repo/pull/7` | The pull request, on its conversation: description, comments and reviews. |
| `…/pull/7/files`, `…/pull/7/changes` | The same tab on its changed files. |
| `…/pull/7/files#diff-<hash>` | The files, with the one the link names opened and scrolled to. |
| `…/pull/7/files#diff-<hash>R42`, `…L3-L9` | The same, with those lines of the new (`R`) or old (`L`) side marked. |
| `…/pull/7/commits`, `…/pull/7/commits/<sha>` | The commit list, or that one commit's diff. |
| `…/owner/repo/commit/<sha>` (with or without `#diff-…`) | The commit's message and diff. |
| `…/owner/repo/discussions/3` | The discussion: body, comments, replies, and which answer was chosen. |
| `…/owner/repo/blob/<ref>/<path>#L10-L20` | The file at that branch, tag or commit, with those lines marked. |
| `…/blob/<ref>/README.md`, `…/docs/guide.md#install` | A markdown file, rendered — scrolled to that heading when the link names one. |
| `…/blob/<ref>/README.md?plain=1`, `…README.md#L10-L20` | A markdown file as code, as GitHub shows it for these links. |
| `…/owner/repo/tree/<ref>/<path>`, `…/tree/<ref>` | A folder at that branch, tag or commit — the repository's root without a path: its folders, its files and its README. |

`#issuecomment-…`, `#discussioncomment-…` and `#pullrequestreview-…` scroll to that comment. A
review comment — `…/pull/7#discussion_r…`, or `…/pull/7/files#r…` — opens the files, with the
comment's file open and the comment marked. A file link that turns out to name a folder lists the
folder, and a folder link that names a file shows the file, as GitHub redirects them. Anything
else — a repository's front page, a release, a gist — still goes to the browser.

The tab scrolls so that what the link names sits near its top — a line of code with a few lines
above it for context. It keeps it there while the tab settles: comments above it render and load
their images, and diffs above it measure their lines, after the first scroll. Scrolling, clicking
or typing in the tab stops that at once.

## How a link opens

A link clicked in a note opens in a tab when **Open GitHub links in Obsidian** is on. Which tab:

1. The item is already open → that tab comes forward and moves to the new line or comment. The
   same item is never open twice.
2. Otherwise, a GitHub tab is open → the GitHub tab used last is pointed at the link, the way a
   browser tab follows a link. With the note on one side of a split and GitHub on the other,
   links keep landing on the GitHub side. A pinned tab is left alone.
3. Otherwise a new tab opens.

A GitHub tab keeps a history like a note does: its back arrow returns to the item or the line it
showed before.

To open a new tab regardless, hold the modifier key, as for any link in Obsidian:

| Click | Reading view and Live Preview | Source mode |
|---|---|---|
| plain | the rule above | places the cursor, as for any link |
| Cmd (Ctrl on Windows and Linux) | a new tab | the rule above |
| Cmd+Shift | a new tab | a new tab |
| Cmd+Alt | a new split | a new split |
| Cmd+Alt+Shift | a new window | a new window |
| Alt | the browser | places the cursor |

In source mode a plain click only places the cursor and Cmd-click is how any link opens there,
so Cmd alone follows the rule and Cmd+Shift asks for the new tab.

A link in a note's **properties** opens the same way — a text property holding an address or a
markdown link, and each address in a list property, in the note, in Reading view and in the
Properties side panel. With the properties shown as source, or in source mode, the front matter is
plain text where Obsidian opens nothing, and an address in it opens as in source mode: Cmd-click.

A right click on a GitHub link offers **Open in Obsidian** (the rule above) and **Open in
Obsidian in a new tab**, whatever the setting. The command **Open GitHub link** opens the link
under the cursor, or asks for one, by the same rule. A link clicked inside a GitHub tab — a commit
in a pull request's list, a link in a comment — follows the rule too, so it usually opens in the
tab it was clicked in.

### Markdown files

A markdown file — `.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn`, and `.mdx`, whose components
render as plain HTML — opens rendered, with **Preview** and **Code** above it. A link naming
lines or carrying `?plain=1` opens the code instead. The switch is the tab's: back, forward and
a restart come back to the view it was left in, and a link followed in the tab opens the way
that link asks. Switching keeps the place — the selected or linked lines when they are in sight,
otherwise whatever was at the top of the tab.

The file is rendered by Obsidian, piece by piece: every heading, paragraph, list item, table,
code block, quote and HTML block is rendered on its own and knows which lines of the file it
came from. That is what lets lines be linked from the rendered view (below). Front matter is
shown as a YAML block. What it means for the rendering:

- A relative link opens that file of the repository in the tab, at the same branch, tag or
  commit; a link to a folder opens that folder's listing, at the same ref. A link to
  a heading — `#install` — scrolls the preview to it. A web or mail address opens as usual.
- A relative image loads from the repository's raw files at the same ref
  (`raw.githubusercontent.com` for github.com, `<server>/<owner>/<repo>/raw/<ref>/<path>` for an
  Enterprise server). When that address refuses it — a private repository, or a server that
  wants a signed-in session — and a token is set, it is read once more through the API with the
  token and shown from memory.
- What keeps someone else's text from acting in the vault is the same for every piece of GitHub
  text the plugin renders — see [GitHub text is someone else's](#github-text-is-someone-elses).
- Reference-style links and footnotes work across the file; footnotes are numbered as GitHub
  numbers them, and a footnote's number scrolls to its text.

A pull request with many files lists them and draws a file's diff only when it is opened; one
with five or fewer opens them all. A file GitHub will not send a diff for — binary, or too
large — says so; the tab's own button opens the page on GitHub.

Every changed file — of a pull request or a commit — can be opened whole: the file button in its
header, or its name, which is a link; each folder of its path is a link too, to that folder's
listing at the same commit (see [Folders and the file tree](#folders-and-the-file-tree)). It opens
the file at the commit the diff is of (the pull
request's head commit, or the commit itself), and a file the change deleted as it was before it
(the base commit, or the commit's parent). It opens at the first selected line of the diff; with
nothing selected, at the line at the top of the tab when the tab is scrolled into that diff;
otherwise at the top of the file — where a markdown file opens rendered, and at a line as code,
by the rule above. The clicks are those of any link here: plain follows the tab rule, Mod opens a
new tab, Alt the browser.

## Folders and the file tree

A link to lines of a file shows the lines; the code around them is a click away, at the same
version of the repository.

**Breadcrumbs.** A file's title is the way up to its repository — `acme / widgets / src / util /
format.ts` — with the branch, tag or short commit it was read at beside it. The repository and
each folder are links to their listing at that same ref: a file read at a commit leads to the
folders as they were at that commit, not as the branch has them now. The folders of a changed
file's path in a pull request or a commit link the same way, at the pull request's head commit
or the commit itself (the base, or the parent, for a file the change deleted). The clicks are
those of any link here: plain follows the tab rule, so the folder usually opens in the same tab,
whose back arrow returns to the file; Mod opens a new tab; Alt the browser.

**A folder in a tab** lists its folders, then its files with their sizes — submodules between
them, which open on GitHub — and renders its README under the list, the way GitHub does:
`README.md` first, any other README otherwise, as rendered text like every piece of GitHub text
here. A relative link in that README resolves in the folder. A folder of thousands of entries
draws them a page at a time as it scrolls. A branch whose name holds a slash is found the way a
file's is: each split of the link is asked, the shortest branch name first.

**The file tree panel** — the folder-tree button in the tab's header — shows the whole
repository beside what the tab shows, at the version it shows: a pull request's head commit, the
commit, the ref a file or a folder was read at, and the default branch for an issue or a
discussion. The file on screen is marked and its folders are open; a folder on screen is marked
and open. Folders fold and unfold with a click. A folder's own page — its listing and README —
opens from the folder button at the end of its row, shown while the row is pointed at (always on a
phone), or by a Mod-click on the folder; both open it in this tab, since a plain click is taken
by folding, and Mod+Shift opens it in a new tab (Mod+Alt a split). the field at the top filters by name, keeping the
folders on the way to every match (a thousand at most, and it says when there are more). A click
on a file opens it at that same version, by the tab rule, Mod for a new tab; the panel stays, and
marks the file that opened.

The repository's file list is one request, kept for the session per repository and commit, so
opening file after file from the panel asks for nothing more. GitHub stops a list past 100,000
entries; then the panel reads a folder when it is opened, and the filter searches only the
folders opened so far — it says so.

Each tab keeps its panel open or closed, through back, forward and a restart. A new tab on a
desktop starts the way the last one was left, as a choice of that device's. On a phone the panel
always starts closed, and when open it is a drawer over the code rather than a column beside it —
the code keeps its whole width; a tap beside the drawer or its close button puts it away, and so
does picking a file. A narrow pane on a desktop gets the drawer too.

## GitHub text is someone else's

Everything written on GitHub that a tab or a note shows — a description, a comment, a review
comment, a commit message, a comment kept in a note as a card, a markdown file — is rendered by
Obsidian's own renderer, which also hands the result to every other plugin. So before and after
rendering it is kept from acting inside the vault:

- a link that is not a web or mail address — `javascript:`, `obsidian:`, `file:` — is shown as
  text and does nothing;
- a code block in a language only a plugin knows (`dataviewjs`, `dataview`, `tasks`, a button…)
  is shown as plain code rather than handed to that plugin;
- inline code carries an invisible mark while it is rendered, so a plugin that reads a code span
  as a command by how it starts — Dataview's `` `= …` `` and `` `$= …` ``, Meta Bind's
  `` `INPUT[…]` `` — does not recognise it; the mark is taken out once the text is on screen;
- an embed of a vault note (`![[…]]`) is shown as its name; a relative link or image points at
  the repository — in a comment at its default branch.

Obsidian offers no way to render without the other plugins, so this is not a wall: a plugin that
acts on ordinary text, not on code spans or code blocks, still sees it.

## Linking to a line or a comment

Every comment, review, review comment, discussion comment and reply, and the item's own
description, has two buttons in its header: **Copy a link** and **Insert a link into the note**.

In a diff and in a file, a click on a line number selects that line and Shift-click extends the
selection to another; a click on the only selected line clears it. The selected lines are marked
like the lines a link points at, and a bar under them offers **Copy link** and **Insert into
note**.

On a phone, which has no Shift, a tap on another line extends the selection to it and a tap on
a selected line clears it; the first tap, with nothing selected, selects one line.

A rendered markdown file does the same by its pieces: pointing at a paragraph, a list item or a
heading shows a link handle at its left — on a phone the handles are always there — and a click
on it selects that piece's lines; Shift-click extends to another piece. The bar is the same, and
so is the link: to the source lines, `…/README.md?plain=1#L10-L20`, which opens the code at them
here and on GitHub. A selection made in one view is still there after switching to the other,
and the pieces a linked or selected range touches are marked in the preview.

The link is markdown with a readable label, and the address is GitHub's own, so it opens the
same place on GitHub and — with the integration on — in a tab here, scrolled to it:

| What | Link |
|---|---|
| Lines of a pull request's diff | `[acme/widgets#42 · src/app.ts:10–20](…/pull/42/files#diff-<hash>R10-R20)` |
| Lines of a commit's diff | `[acme/widgets@1a2b3c4 · src/app.ts:5](…/commit/<sha>#diff-<hash>R5)` |
| Lines of a file | `[acme/widgets@1a2b3c4 · src/app.ts:10–20](…/blob/<sha>/src/app.ts#L10-L20)` |
| Lines of a markdown file | `[acme/widgets@1a2b3c4 · README.md:3–7](…/blob/<sha>/README.md?plain=1#L3-L7)` |
| A comment | `[acme/widgets#42 · comment by alice](…/pull/42#issuecomment-123)` |
| A review, a review comment | `… · review by alice` (`#pullrequestreview-…`), `… · review comment by alice` (`#discussion_r…`) |
| A discussion comment, a reply | `… · comment by alice`, `… · reply by alice` (`#discussioncomment-…`) |

In a diff, an added or unchanged line is linked on the new side (`R`), a removed one on the old
side (`L`, and the label says "before"); a selection from a removed line to an added one is
linked by its added lines. A file's link is pinned to the commit it was read at rather than the
branch — asking GitHub for that commit once, when the first link is made — so it does not drift
as the branch moves on.

**Insert into note** writes the link at the cursor of the note last worked in: after the
cursor's line when that line has text, in its place when it is empty, and leaves the cursor after
it so the next link goes under it. With no note open it says so and writes nothing. **Copy
link** puts the same markdown on the clipboard.

### Code and comments kept in a note

Beside the two link actions there is a third that writes the thing itself into the note: **Insert
with code** in the bar under selected lines, and **Insert as quote** (the quote mark) in a
comment's header. It goes in at the cursor of the note last worked in, as a block with a blank
line either side, and is drawn as a card:

- the label, as a link — clicked, it opens the place in a GitHub tab by the rules above (Cmd for
  a new tab, Alt for the browser); with the integration off it goes to the browser;
- the lines, highlighted, numbered as they were in the file; a diff's with both columns of
  numbers and its added and removed lines coloured;
- a comment's text as markdown, under who wrote it and when.

Long lines scroll sideways inside the card, and a long snippet scrolls within a fixed height.
The code is stored in the note, so the card reads offline and stays what it was when it was
taken — lines of a file are also linked by commit, not branch, for the same reason. The block's
format is in the plugin's vault reference; a block edited by hand into something it cannot read
is shown as plain text rather than an error.

## Asking an agent about it

With the AI chat on, a GitHub tab is something to talk about:

- **Chat about this** — the speech-bubble button in the tab's header, the same item in the
  tab's "more options" menu, and the command **Chat about this GitHub item** — opens a new chat
  with a link to the item in its input. Nothing is sent: say what you want and send it yourself.
  With lines selected it does what **Ask here** does.
- **Ask here**, in the bar under selected lines, does the same with a link to those lines and
  their code quoted under it: a diff's lines as a diff, a file's in its language.

The agent answering reads GitHub with its own tools. It can see which GitHub tabs are open, what
each shows — the item or folder, the section in front, the diffs drawn open, the lines selected
and their code, whether the file tree is open beside it — read issues, pull requests and discussions with their conversations, a pull request's files
and one file's diff at a time, files and folders at any branch or commit, commits and
comparisons, and search code, issues and pull requests. It can also put something in front of you:
open an item or a folder in a GitHub tab, with lines marked. A link it writes in its answer opens in a tab
like a link in a note.

These tools read and nothing more; the integration still writes nothing to GitHub. They use the
same token and server as the tabs, so an agent sees exactly what you can, and a refusal comes back
in the same words. They are offered only while GitHub is on in the settings, and are on for every
agent; each can be set to **Ask** or **Off** in the agent's tools, under GitHub. Answers are kept
short — a page of comments, a window of a diff, a range of lines — and the agent asks for the next
part when it needs it, so a large pull request is never sent to the model whole.

Code search needs a token on github.com (GitHub does not search code for anonymous requests) and
searches only default branches. Without a token every request an agent makes comes out of the same
60 an hour the tabs use.

## Searching

### Find in the tab

**Mod+F** (Cmd+F, Ctrl+F on Windows and Linux) while a GitHub tab is focused — or the magnifier
in its header — opens a find bar at the top of the tab. Obsidian's own find works only in a
note, so a GitHub tab has its own. It searches everything the tab shows: the description and
comments, the header, a markdown file as it is rendered (or its code, when switched to Code), and
the code — a file, and every diff, including the files of a long pull request that are still
folded shut. It says how many matches there are and which one is current
("3 of 17"); **Enter** goes to the next, **Shift+Enter** to the previous, both wrapping round,
and **Esc** closes the bar. The toggle beside the field matches letter case.

The tab scrolls to the current match. A match inside a folded diff file opens that file when it
becomes current — not while the query is still being typed, so typing never unfolds half a pull
request. Matches in text are painted with the browser's highlight API, which leaves the page
itself untouched; on a phone whose WebView lacks it the count and the scrolling still work, the
matches are just not coloured. The count follows the tab as it changes: comments that load and
files that open are counted again.

### Code search

The file-search icon in the header opens a panel that searches the code at the version the tab
shows — a pull request's head commit, the commit, the branch, tag or commit a file was read at,
and the default branch for an issue or a discussion. It has three scopes:

| Scope | Searches |
|---|---|
| **Only the changed files** (pull requests and commits) | The lines of the diffs: added, removed and the context around them. A removed line is found and labelled "before". A file too large for GitHub to send a diff for is read whole at the head commit, up to twenty of them. |
| **Whole repository at …** | Every text file of the repository at that commit. |
| **File names at …** | Paths holding every word typed, the file's own name before a folder that happens to match. Found as it is typed. |

The query is plain text by default; the toggles make it match letter case, whole words only, or
read it as a regular expression. The second field narrows to files matching a glob — `*.ts`,
`src/**/*.py`, several separated by commas; a glob without a slash matches the file's name in any
folder. Results are grouped by file, with each line's number and its text, the match marked. A
click opens the place: a line of the change in the pull request's files or the commit, a line of
the repository as the file at that commit (so the link cannot drift as a branch moves). A line of
a markdown file opens its code at that line (`?plain=1`, as GitHub writes it); the file's own
name opens it rendered. The tab
rules above apply — the result usually opens in the same tab, whose back arrow returns to the
search's item — and Mod-click opens it in a new tab. The panel stays open, with its results, while
the tab follows them, so the next result is one click away; a search from there searches the
version that tab now shows. At most 500 lines, 50 per file, are shown;
the summary says when there are more, and narrowing the glob is how to see them.

#### How the whole repository is searched

The first whole-repository search of a commit downloads that commit's archive — one request for
the file list, one for the archive — and unpacks it in memory, then searches there; every later
search, and go to definition, at the same commit answers at once. The panel says which stage it is
at and has **Cancel**, which stops waiting; a download already under way finishes and is kept for
the next search. Nothing is written to disk and nothing survives a restart. Binary files and files
over 1 MB are left out. The four most recently used repositories are kept, up to about 400 MB of
text between them, the oldest dropped first.

Before anything is downloaded the file list says how big the repository is at that commit: its
files' sizes added up. Over **Largest repository to download** (Settings → GitHub → Code search,
100 MB by default) — or when GitHub will not list the whole repository, past 100,000 files — it
is not downloaded. GitHub's own code search answers instead, and the panel says so above the
results: it knows only the default branch, takes no regular expressions, gives fragments rather
than line numbers, and needs a token.

Without a token the file list and the archive count against the 60 requests an hour like
anything else — two requests for a whole repository, however many times it is searched after.

### Go to definition

In any code view in a GitHub tab — a file, a diff — **Mod-click** a name to go to where it is
declared. Holding Mod while pointing underlines the name that would be followed, as an editor
does. A right click on a name offers **Go to definition** and **Find references**; the latter
fills the code search with the name as a whole word, letter case matched, across the whole
repository.

It is a guess by pattern, not a compiler's answer: it looks for lines that declare the name in
the syntax of each file's language — `function`, `class`, `interface`, `type`, `enum`,
`const`/`let`/`var … =`, methods and function-valued fields in TypeScript and JavaScript; `def`,
`class` and module-level assignments in Python; `func`, methods `func (r T) name`, `type`, `var`
and `const` in Go; and the usual declarations in Java, Kotlin, C#, Swift, Rust, Ruby, PHP, C and
C++. It uses the same downloaded repository as the code search, at the tab's commit. The nearest
candidates come first: the same file, then the same folder, then files in the same language,
then the rest — and within each, the code before tests, fixtures and mocks (`__tests__/`,
`test/`, `spec/`, `*.test.ts`, `*_test.go`, `test_*.py`, `*Test.java` and the like), where a name
is usually a stand-in for the real one. One candidate opens at its line; several are offered in a picker showing each file
and line with the line's text — type to narrow by path, Mod+Enter or Mod-click to open the choice
in a new tab; none is said in a notice, which reminds that the lookup can miss. For a repository
over the size limit it looks only at what the tab already has: the file shown, or the new side of
the changed lines.

It can miss what is declared unusually — generated code, a name re-exported under another, a
declaration spread over lines — and can offer a same-named declaration from elsewhere. On a phone
there is no Mod key and no right click: holding a finger on a name for half a second opens the
same menu.

The menu also offers **Copy**: the selected text when there is some, the name otherwise. On a
phone that is what stands in for the word the long press would have selected — on a name the
press opens the menu and the phone's own selection is dropped, so the two do not both appear.
Held anywhere else in the code — a space, a bracket, an operator — and everywhere outside the
code, the press selects text the way the phone always does.

## Selecting and copying text

Everything a tab shows can be selected and copied as text: the title, the description and
comments, a rendered file, and the code of a file or a diff. Obsidian makes its own interface
unselectable, so the tab gives selection back itself; its buttons, tabs, icons and line numbers
stay unselectable, so a drag across a diff copies its lines as they are in the file — no numbers,
no `+` or `-`. A changed file's path in its head is selectable too, and the click that ends a
drag over it does not fold the diff.

## Access

Without a token only public repositories can be read, at 60 requests an hour for the whole
machine, and discussions not at all (GitHub serves them only to a signed-in request).

With a **fine-grained personal access token** (GitHub → Settings → Developer settings → Personal
access tokens → Fine-grained tokens):

- **Repository access**: the repositories to read, or all of them.
- **Repository permissions**, all **Read-only**:
  - **Contents** — files at a ref, and commits;
  - **Issues** — issues and their comments;
  - **Pull requests** — pull requests, their files, reviews and review comments;
  - **Discussions** — discussions.
  - **Metadata** is added by GitHub on its own.

The token is stored in Obsidian's keychain; the settings file holds only the name of the slot.
For an organisation's repositories the token's **Resource owner** has to be that organisation,
not your own account: a fine-grained token only reaches the repositories of the one owner picked
when it was made.

**Check access** in the settings asks GitHub what the token can read. Leave the field beside it
empty and it says whose token it is. Give it a repository — `owner/name`, or any link into it,
such as a pull request you could not open — and it tries each permission on that repository with
one small request and shows a row for each: **OK**, **Refused** with the cause, or **Skipped**.
Above the rows it says whether a token was sent at all (its kind and length, never the token),
whose it is, when it expires if it does, and which API address was asked. The check uses the
same token and the same address a tab for that repository would.

## When access is refused

A refused tab and a refused row lead with the cause and name the request that was refused — "the
pull request's reviews", not just "the pull request". Under it: **Needs:** the permission GitHub
says that request required, and **GitHub said:** its own message, word for word.

| What you see | What it means | What to do |
|---|---|---|
| *GitHub refused … to this token* (GitHub: "Resource not accessible by personal access token") | The token lacks the permission named under **Needs**, or the repository is not in its list, or its Resource owner is your account rather than the organisation. | Edit the token on GitHub: add the permission, add the repository, or make a new token with the organisation as Resource owner. |
| *GitHub found nothing for …* (404) with a token | GitHub answers "not found" rather than "forbidden" for a private repository the token cannot see: same causes as above, or a token still waiting for an organisation owner's approval, which reads public data only. | Check the repository list and Resource owner; ask an owner to approve the token. |
| *… only accepts requests from its allowed IP addresses* | The organisation has an IP allow list and this device's address is not on it. The token is fine — which is why it can work from another machine and not from this one. | Connect through the office network or VPN, or ask an owner to add the address. |
| *… refuses fine-grained tokens that are valid for longer than it allows* | The organisation caps token lifetime (366 days by default) and this token's is longer. | Shorten its expiration on GitHub (GitHub's message has the link) or make a new one. |
| *… does not accept fine-grained personal access tokens at all* | The organisation's token policy forbids them. | Only an organisation owner can change it. |
| *… does not accept classic personal access tokens* | The organisation forbids classic tokens. | Use a fine-grained token with the organisation as Resource owner. |
| *This organisation uses single sign-on …* | The token has not been authorised for the organisation's SSO. | Follow the link given, or GitHub → Settings → Personal access tokens → the token → Configure SSO. |
| *No token was sent with these requests* (in Check access) | Nothing reached GitHub with a token: the keychain on this device has none — tokens are kept per device — or the link is on github.com while **Server** points at an Enterprise server, whose token is not sent anywhere else. | Paste the token again on this device, or clear **Server**. |

### Only the item itself can fail the tab

A pull request is one request for itself and several for what hangs off it: its comments, its
reviews, its changed files with their review comments, its commits. Only the pull request itself
— or the issue, or the discussion — decides whether the tab opens. When one of the others is
refused, the tab still shows everything else, and in that section's place says what was refused,
in the same words as above, with a **Try again** that asks for that section alone.

When the item itself was read and a section is refused on a permission the item already proves
the token holds — a pull request's comments asking for *Issues (read) or Pull requests (read)*,
when reading the pull request took *Pull requests (read)* — the notice says so rather than
sending you to grant it: the server refuses that one request, and the token is fine.

Before giving up on a section, a refused one (403 or 404) is asked again through GitHub's GraphQL
API — `/graphql` on github.com, `/api/graphql` on an Enterprise Server — which is what `gh` uses,
and which can answer where REST refuses the same token. Comments, reviews, review comments and
commits come back complete from it, and a link to a comment still scrolls to it. Changed files
come back as a list without their diffs, because GraphQL does not carry diffs; each file says
so. GraphQL always needs a token, so without one this second attempt is not made. If GraphQL
refuses too, its answer is added under GitHub's REST message.

Obsidian sends its requests through the system's network settings, proxy and VPN included, so it
can leave from a different address than a terminal or another program on the same machine — which
matters for an IP allow list.

### GitHub Enterprise

Put the server's address in **Server** — `https://github.example.com`. Its API is found at
`/api/v3` (and `/api/graphql`) on the same host; for GitHub Enterprise Cloud with data residency
(`name.ghe.com`) at `api.name.ghe.com`. Links to that host then open in tabs, read with the
token; links to github.com still open too, read without it.

The address can be written any way it is usually pasted — with or without `https://`, in any
letter case, with `www.`, a port or `/api/v3` — and links to that host match it the same way.
Every link the plugin writes for that server — a copied link, a card's link, a search result,
"Open file", a link given to an agent — starts the way **Server** does, scheme and port included
(`http://git.example.com:8080/…`), so it opens in a browser too. Requests to an Enterprise Server carry no `X-GitHub-Api-Version` header, which servers older than
3.9 refuse. **Check access** shows which host a link resolved to, which host the token is set
for and which API address was asked, so a link that is read without the token is visible at once.

## What it costs

Nothing runs in the background: GitHub is asked only when a tab opens, is refreshed, a pull
request's files or commits are first shown, or a search or a definition lookup asks for the
repository. Answers are kept in memory with their ETag and asked about again with
`If-None-Match`; an unchanged answer does not count against the limit.
