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
**Check access** in the settings sends one request and says whose token it is.

An organisation that uses single sign-on has to have the token authorised for it; when it has
not, the tab says so and gives GitHub's link for doing it. An organisation can also require
fine-grained tokens to be approved by an owner before they see anything.

### GitHub Enterprise

Put the server's address in **Server** — `https://github.example.com`. Its API is found at
`/api/v3` (and `/api/graphql`) on the same host; for GitHub Enterprise Cloud with data residency
(`name.ghe.com`) at `api.name.ghe.com`. Links to that host then open in tabs, read with the
token; links to github.com still open too, read without it.

## What it costs

Nothing runs in the background: GitHub is asked only when a tab opens, is refreshed, or a
pull request's files or commits are first shown. Answers are kept in memory with their ETag and
asked about again with `If-None-Match`; an unchanged answer does not count against the limit.
