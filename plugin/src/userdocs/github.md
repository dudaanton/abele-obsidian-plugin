# GitHub

Issues, pull requests, discussions, commits and files from GitHub, opened in Obsidian tabs.
Repository files are read-only. The single inbox supports each connected service’s notification actions.

## Forgejo and Gitea

Under **Connections → Add connection**, choose **Forgejo** or **Gitea**, enter the full server address
(including any deployment path or port), a connection name and an optional access token.
**Use Codeberg** fills in its address; the connection remains an ordinary Forgejo connection.
**Check access** tests the draft account and, when supplied, repository permissions without
storing the token. **Save** keeps it; **Cancel** discards the draft. Changing the service or
server requires a fresh credential binding. Without a token, public repositories remain readable.

Open a configured server's repository, issue, pull request or file URL from a note or paste it
into **Open GitHub link or item**. Repository pages show their files and README, with branches
and tags in the existing version picker. Pull requests have conversation, changed files with
patches and inline review comments, and commits. Secondary failures leave readable content in
place and explain what could not be loaded. The account button selects another connection on
that exact deployment; an explicitly selected account never silently falls back to another.

Native file pages also support a frozen comparison base, exact endpoint tree/blob diffs,
commit details and file history. Comparison bases remain local to the device and are scoped to
the provider, full deployment address, repository and connection. Unique identical blobs are
recognized as renames; binary, oversized, symlink, LFS and submodule states retain their explicit
limits. Repository text search, regular expressions, file-name search and heuristic definitions
use the selected immutable revision. Changed-code search reads the available text patches;
results open the change without an invented precise diff anchor, and missing text patches are
reported as incomplete. Repository text search downloads that commit's native archive within
the configured size limit; an oversized repository does not silently search another branch.

Lists and pickers use the chosen connection. Common title, author, assignee, label, milestone,
state and sort filters are supported; unsupported qualifiers are explained. Bounded partial
lists do not claim exact totals. People use native profiles; external avatar hosts are not
fetched automatically. Sharing preserves immutable file links where the service supports them.
Native snippets use a versioned `abele-forge` card that keeps its text offline.

The inbox account selector switches among all connections in the same pane. Forgejo and Gitea
support Mark read, including a bounded snapshot cutoff for bulk reads. They do not support
Done; reading a notification never closes or merges its issue or pull request.

Comments are sent only by pressing Comment. Merge asks for confirmation and binds the exact
head commit, without forcing, queueing or deleting the branch. Node branches can create pull
requests on a configured root deployment; older host-only node metadata cannot identify a
service installed under a URL subpath. Draft creation and true threaded review replies are
unavailable in the pinned APIs; use the service in a browser. A lost comment, PR creation or
merge response stops resubmission for that operation in the current session; check the service
before proceeding. Idempotent notification reads can be retried explicitly after checking the
inbox. No write is replayed automatically.

Browsing needs read access only. Posting a comment needs issue/comment write access; creating
or merging a pull request needs repository write access and must also satisfy the service’s
branch protection and merge rules. A successful read-only access check does not grant these
write permissions.

The eight `forge_*` agent tools and their `github_*` compatibility names read native services.
Tool permissions and connection Off/Ask/On permissions are independent; new connections and
neutral tool names default Off. Delegated agents keep their parent’s access ceiling.
Blame, discussions, a global server code index and precise native diff anchors remain
unavailable. Endpoint comparisons use verified trees; native merge-base comparisons explain
when file or patch information is missing, including Gitea’s smaller comparison response.

Images hosted by GitHub (or the repository's Enterprise server) load normally. Images from
other sites, including README badges, appear as buttons naming the site; tap one to load that
image. This applies to files, comments and GitHub snippets. It does not change images in AI replies.

GitHub markup cannot embed frames or forms. Inline styling keeps only text colour, background
colour and alignment, so a page cannot position a fake window over Obsidian. Some unusual
README layouts therefore look simpler here. External links open only HTTP(S) or email, and
large READMEs with many unmatched backticks no longer repeatedly rescan the entire text.

## Repositories on a node

**Open node repository** chooses a connected node, a project and a workspace, then opens the same repository tab used for GitHub. The workspace files dialog also offers **Open repository**. Node browsing does not require the GitHub integration to be enabled.

Use the compact header picker to choose the project folder, a node workspace, an allowed external workspace, or another version. **Current files** includes edits that have not been committed. The home page lists **Uncommitted changes**, recent commits, files and the README. **Partly ready** means a file has changes both prepared for a commit and still outside it; **Ready**, **Edited**, **New** and **Deleted** describe the other states.

The repository actions menu offers file history, comparison bases and external-workspace browsing. External browsing needs owner approval for the project and remains read only; it does not allow agent execution or editing. Human browsing does not grant an agent access. Node content cannot load GitHub images or use GitHub credentials.

Compare current files with HEAD or another version. The changes filter separates **All changes**, **Ready for commit** and **Other edits**. Counts load with each file's changes. Commit versions and captured links stay fixed; current files refresh when the node reports a change. Local editing opens the existing workspace editor, where a changed-on-disk notice preserves the draft rather than replacing it. Saved tabs and comparison bases remain local to this device, with no node credentials in their state or links.

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
Existing agents that never had connection permissions keep access to that original connection,
following their GitHub tools' On/Ask modes. An explicit permission list, including an empty list
or Off, is left alone. New agents and new connections still need access enabled in the agent's
**Access** settings.
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

## Comparing file links against a pinned base

On a file, folder or repository page, choose **Compare against…** and enter a commit SHA,
branch or tag. The picker resolves the name and shows the full commit SHA before you confirm.
The base is frozen to that commit: a branch or tag moving later does not move your comparison.
These comparison bases are separate from the pinned repositories in the repository picker.
They survive restarts in this vault **on this device only**; they are not synced or transferred.
Different server schemes and ports, and different repositories, have independent bases.

While a base is pinned, file links show a unified, read-only diff from that exact base to the
commit the link names—not GitHub's merge-base comparison. A mutable target branch is resolved
once when opened; both the text and project tree use that commit. Each tab keeps its own target,
even when another tab opens a different commit, you change the base, or you close and reopen
the project drawer. Linked lines always
refer to the target side, including unchanged context far from a change. Identical files remain
readable and say **No changes in the text of this file**.

The file tree offers **All files** (target files with change markers and deleted paths) and
**Changed files** (the complete endpoint difference). Both modes use the same statuses and
counts and open the same comparison-aware file view. Deleted entries show the base-side text
with an empty target; opening one does not change the comparison's target commit. Renames are
shown only with reliable endpoint metadata or a unique identical blob match. Otherwise the
old and new paths remain separate removed/added entries. A reliably paired rename also opens
when a link uses the old name. When a file becomes a folder or a folder becomes a file, both
endpoint entries remain in the tree, distinguished by their icons and statuses; removed
folders expand to their deleted files without following a target file as if it were a folder.
Modifier-clicks on removed folders also expand or fold those entries, rather than opening a
target page. A surviving parent of a deleted file remains a normal folder in **Changed files**
and keeps its folder-page action.

**Change base** replaces the frozen base for this repository's tabs. **Unpin** restores the
existing file views everywhere for that repository. **Original file** escapes the comparison
in this tab only; **Show comparison** returns without removing the repository base. Explicit
pull request, commit and compare pages keep their existing behavior. Original URLs, line links,
account choices and navigation history are retained.

The diff keeps the normal find, copy, quote and Ask actions. A removed-line selection links to
the base commit; added and unchanged selections link to the target commit, using ordinary blob
permalinks rather than invented compare anchors. **Open base** and **Open target** open either
side on GitHub. On a phone the tree is a drawer and the diff stays unified at full content width.

Text counts are computed from the complete file texts. **…** means not yet counted; **—** means
unavailable, not zero. Binary files and unsupported encodings retain their status, sizes and
side-opening actions. Symlinks show their stored link text without following it, submodules
show commit metadata without fetching another repository, and LFS files show pointer text
without downloading payloads. Large files and many-line diffs require **Load large diff**;
files beyond the memory/line budget or GitHub's API limits can still be opened on either side.

Loaded immutable trees and file bytes remain available offline in bounded session memory.
Uncached portions explain the failure and can be retried with the header's refresh action.
Restarting or changing credentials forgets private-source caches. GitHub's primary and secondary
rate limits pause uncached requests until the reset or retry time; accounts are never switched
to get around a rate limit.

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

At the top of a file, below its pinned path, **Blame** shows who last changed each range of lines: the author, relative date and
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
**Access → Git repository connections**, choose **Off**, **Ask**, or **On** for each connection. A new
connection starts Off on every server. Ask approves one operation in an interactive chat;
background/delegated runs cannot ask. On still respects the tool's own Off/Ask/Auto setting.
The tools accept a connection name, and their tab inventory hides content from connections the
agent cannot use. Granting broad scripting or settings-writing tools is a separate, broader
permission; this connection list is not a general sandbox.

## Page width and people

**Page width** sets how wide a tab's text runs: your notes' line width, a fixed width in pixels, or
the full tab. Code and diffs always take the whole tab. **Show people by** picks names or logins.
Names and pictures are kept on this device for a week; **Kept names and pictures** clears them.

## Node code tooltips

In node code views, hold Ctrl, Cmd or Alt (Option) while pointing at a symbol to show its
type and documentation. Releasing the key hides the tooltip. Cmd/Ctrl-click or Alt-click
opens a definition (or a chooser for several matches). Holding any of these modifiers
underlines the symbol to follow.

In repository code, Ctrl-click (Cmd-click on macOS) or Alt-click a relative import, export,
require or dynamic import path to open its file at the same revision. Extensionless paths and
directory index files are resolved from the repository tree. On a phone, the code menu offers
**Open imported file** when the line contains exactly one relative module path.
