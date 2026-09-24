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

`#issuecomment-…`, `#discussioncomment-…` and `#pullrequestreview-…` scroll to that comment.
Anything else — a repository's front page, a folder, a release, a gist — still goes to the
browser.

A link clicked in a note opens its tab when **Open GitHub links in Obsidian** is on; hold Alt to
send it to the browser instead. The command **Open GitHub link** opens the link under the
cursor, or asks for one. A right click on a GitHub link offers **Open in Obsidian** either way.
The same item is never open twice: a second link to it brings its tab forward and moves to the
new line or comment.

A pull request with many files lists them and draws a file's diff only when it is opened; one
with five or fewer opens them all. A file GitHub will not send a diff for — binary, or too
large — says so; the tab's own button opens the page on GitHub.

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
Requests to an Enterprise Server carry no `X-GitHub-Api-Version` header, which servers older than
3.9 refuse. **Check access** shows which host a link resolved to, which host the token is set
for and which API address was asked, so a link that is read without the token is visible at once.

## What it costs

Nothing runs in the background: GitHub is asked only when a tab opens, is refreshed, or a
pull request's files or commits are first shown. Answers are kept in memory with their ETag and
asked about again with `If-None-Match`; an unchanged answer does not count against the limit.
