# GitHub

Issues, pull requests, discussions, commits and files from GitHub, opened in Obsidian tabs.
Repository content is read-only. The notifications inbox can mark notifications read or Done.

Images hosted by GitHub (or the repository's Enterprise server) load normally. Images from
other sites, including README badges, appear as buttons naming the site; tap one to load that
image. This applies to files, comments and GitHub snippets. It does not change images in AI replies.

GitHub markup cannot embed frames or forms. Inline styling keeps only text colour, background
colour and alignment, so a page cannot position a fake window over Obsidian. Some unusual
README layouts therefore look simpler here. External links open only HTTP(S) or email, and
large READMEs with many unmatched backticks no longer repeatedly rescan the entire text.

## Turning it on

The integration is off until you turn it on in **Settings → Abele → GitHub**. Without a token only
public repositories open, and discussions not at all. For private repositories, create a
fine-grained personal access token on GitHub with read-only access to **Contents**, **Issues**,
**Pull requests** and **Discussions**. Under **Connections**, choose **Add connection**, give it
a name and paste the token into its editor. The token is kept in the keychain only when you
choose **Save**; checking access or cancelling does not store it. **Check access** discovers the
account and tests repository permissions with that connection alone. A repository on another
server needs its own connection.

Each connection has a server (empty is github.com), an optional repository-owner list, and a
**Default for this server** mark. Exactly one connection is default on each configured server.
GitHub Enterprise addresses may include an explicit scheme and port. Existing token/server
settings migrate to one connection with the same keychain slot, without re-entering a token.
The list travels as individually selectable entries in settings transfer, with tokens only when
keys are included. Synced keys include every connection. Delete asks for confirmation and
forgets the local slot without revoking the shared token on other devices. A transfer cannot
reuse a receiving device's existing token slot for a different server, even when replacing the
whole list or sending no keys. Such a transfer is refused before applying settings or keys;
create a separate connection with its own token slot on the sending device first.

## What opens in a tab

With **Open GitHub links in Obsidian** on, a click on a GitHub link in a note opens it in a tab:

- an issue, with its comments;
- a pull request, with its conversation, changed files, commits and reviews;
- a discussion, with its replies and chosen answer;
- a commit, or a comparison of two branches;
- a file at a branch or commit, with the linked lines marked; a markdown file is shown rendered;
- a folder, with its files and README;
- a repository's front page: its description, stars and topics, the branch or tag shown with a
  button to switch, the latest release, the five freshest open pull requests and issues, its
  languages, and its files with the README.

- a repository's list of pull requests, issues or discussions, with GitHub's search query on top
  and filters for state, author, assignee, label, milestone, review, draft and sort.

Anything else, such as a release, still goes to the browser.

## File tree width

On a wide screen, drag the divider beside the file tree to resize it. The tree stays between
12em and the smaller of 40% of the tab or 36em. Double-click the divider to restore its default
18em width. You can also focus the divider with Tab: Left/Right resize, Shift makes larger steps,
Home/End choose the limits, and Enter resets. The width is remembered in this vault on this device
only, not synced or transferred. On a narrow screen the tree remains a drawer over the content.

## Choosing an account

A link inside a GitHub tab keeps that tab's connection on the same server. Otherwise an open
repository context wins, then the most specific owner preference, a successful choice remembered
this session, and the server's default. Exact owner/repository rules outrank owner rules, which
outrank owner globs. Different schemes and ports are different servers.

If the primary item refuses access, other connections on that same server are tried; the tab
says which account opened it. Rate limits, network errors and expired credentials do not cause
an account switch. A manual **Open as…** choice never silently falls back. Click the account
button or use the tab menu to switch, or choose **Always use … for this owner**. More-specific
repository preferences still take precedence. Back/forward and restored tabs keep their account.
A deleted saved connection is resolved again with an explanation.

## Opening by number or name

**Open GitHub link or item** takes a pasted link, `#123`, `owner/repo#123`, a branch, a commit or
words of a title, and suggests matches as you type. A bare number is looked up in the repository
you used last, or in the **Default repository** from the settings.

## Opening a repository

**Open GitHub repository…** lists your pinned repositories, the ones you opened lately on this
device, your own and your starred ones (these two need a token), and searches GitHub for anything
else you type. **Alt+Enter** pins or unpins the highlighted repository; a GitHub tab's menu has
**Pin repository** too. Pins are kept in the settings, so they appear on your other devices, and
**Settings → Abele → GitHub → Pinned repositories** lists them.

## Notifications

**Show GitHub notifications** opens your GitHub inbox in the right sidebar — **All** (read and
unread, not Done) by default, or only unread, from every repository or one. Clicking a row opens
the pull request, issue or discussion at the latest comment and leaves it unread. The row's
check means **Done on GitHub**, removing it from the inbox without unsubscribing. The double
check at the top marks all **read, not Done**; read rows remain in All. Releases, workflow runs
and alerts open on GitHub. The list refreshes as often as GitHub allows; refresh asks at once.

If Done fails, the row stays and the panel explains GitHub's refusal, including the HTTP status,
thread ID and which token was used. Refresh does not clear that failure; retry with the row's
check after fixing the cause. The write uses the same token/server that supplied the row.

If GitHub accepts Done but returns that unchanged notification again, a notice says it is hidden
by a **local fallback for this session only**, not confirmed removed from the web inbox.
**Show locally hidden** restores GitHub's list. This memory is not saved or synced; it holds the
last 1,000 Done thread versions per token/server. Changed notification data, including a new
update timestamp or comment/review URL, brings the row back; read/unread changes alone do not.
PR reasons are not filtered, so a later review or mention is not silently discarded.

Bulk Read applies only up to the displayed snapshot; notifications arriving later stay unread.
Polling retains disappeared rows as read until refresh or a filter change, except explicitly
Done versions. Switching connections clears the old rows, errors and local-fallback notice;
responses still in flight from the old connection cannot overwrite the new inbox.

GitHub lets only a **classic** personal access token read notifications, with the
**notifications** scope (or **repo**). A fine-grained token cannot, whatever it is given. Put a
classic one in **Settings → Abele → GitHub → Notifications token**: the panel reads with it, and
everything else keeps the default connection's token. This classic token stays bound to the
server where it was set, even if the default moves to another host. Left empty, the panel uses
the default connection's token. The existing single inbox is retained; adding connections does
not combine their notifications.

## Linking and quoting

Select lines of code or of a diff by clicking their line numbers (Shift-click extends the
selection). The bar under them copies a link or inserts one into the note you were working in.
**Insert with code** puts the lines themselves into the note as a card, and **Insert as quote**
does the same for a comment. Every comment has link buttons in its header. Links point at a fixed commit, so they keep showing the same lines.

## Line blame

In a file, **Blame** shows who last changed each range of lines: the author, relative date and
first line of the commit message. It uses the file's displayed branch, tag or commit, not the
repository's default branch. Markdown switches temporarily to source while blame is on.
Click a range's message to open that commit in the same tab; hover for the full message and
exact date. On a phone, hold the range to open these details, with an **Open commit** button.
The compact phone gutter keeps the author and message; the date is in the details. Press
**Blame** again to give the code its full width back.

Blame needs a token, even for public files, because GitHub serves it through GraphQL. It uses
the same connection as the file. A refused request leaves the file readable and offers
**Try again**. Results stay in memory briefly per connection, repository, ref and path;
only visible gutter rows are drawn, including in large files. Changing or removing the
connection invalidates its cached blame. An agent's `github_file` blame option follows the
same per-connection **Off / Ask / On** permissions as its other GitHub reads.

## Searching

**Mod+F** in a GitHub tab finds text in everything the tab shows, folded diffs included. The
code search button searches the repository's code at the version the tab shows. **Mod-click** a
name in code to go to where it is declared; a right-click also offers **Find references**.

## Asking an agent

With the AI chat on, **Chat about this GitHub item**, or the speech bubble in the tab's header,
starts a chat with a link to the item. **Ask here** does the same for selected lines or words,
quoted. Agents can also read GitHub themselves while the integration is on. In each agent's
**Access → GitHub connections**, choose **Off**, **Ask**, or **On** for each connection. A new
connection starts Off on every server. Ask approves one operation in an interactive chat;
background/delegated runs cannot ask. On still respects the tool's own Off/Ask/Auto setting.
The tools accept a connection name, and their tab inventory hides content from connections the
agent cannot use. Granting broad scripting or settings-writing tools is a separate, broader
permission; this connection list is not a general sandbox.

## Page width and people

**Page width** sets how wide a tab's text runs: your notes' line width, a fixed width in pixels, or
the full tab. Code and diffs always take the whole tab. **Show people by** picks names or logins.
Names and pictures are kept on this device for a week; **Kept names and pictures** clears them.
