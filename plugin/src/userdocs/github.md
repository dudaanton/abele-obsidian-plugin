# GitHub

Issues, pull requests, discussions, commits and files from GitHub, opened in Obsidian tabs. It only
reads: nothing is ever written to GitHub.

Images hosted by GitHub (or the repository's Enterprise server) load normally. Images from
other sites, including README badges, appear as buttons naming the site; tap one to load that
image. This applies to files, comments and GitHub snippets. It does not change images in AI replies.

GitHub markup cannot embed frames or forms. Inline styling keeps only text colour, background
colour and alignment, so a page cannot position a fake window over Obsidian. Some unusual
README layouts therefore look simpler here.

## Turning it on

The integration is off until you turn it on in **Settings → Abele → GitHub**. Without a token only
public repositories open, and discussions not at all. For private repositories, create a
fine-grained personal access token on GitHub with read-only access to **Contents**, **Issues**,
**Pull requests** and **Discussions**, and paste it into the **Token** field. It is kept in the
device's keychain. **Check access** tells you what the token can read, and why a request was
refused.

GitHub Enterprise works too: put your server's address in **Server**.

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

**Show GitHub notifications** opens your GitHub notifications in the right sidebar — the unread
ones, or all of them, from every repository or one. Clicking one opens the pull request, issue or
discussion in a tab, at the latest comment, and leaves it unread. The check on a row marks it
read on GitHub; the double check at the top marks them all. Rows never vanish while you read:
one marked read stays, no longer bold, until you refresh. Releases, workflow runs and alerts open on GitHub. The list refreshes while it is open, as
often as GitHub allows, and the refresh button asks at once.

GitHub lets only a **classic** personal access token read notifications, with the
**notifications** scope (or **repo**). A fine-grained token cannot, whatever it is given. Put a
classic one in **Settings → Abele → GitHub → Notifications token**: the panel reads with it, and
everything else keeps your main token. Left empty, the panel uses the main token.

## Linking and quoting

Select lines of code or of a diff by clicking their line numbers (Shift-click extends the
selection). The bar under them copies a link or inserts one into the note you were working in.
**Insert with code** puts the lines themselves into the note as a card, and **Insert as quote**
does the same for a comment. Every comment has link buttons in its header. Links point at a fixed commit, so they keep showing the same lines.

## Searching

**Mod+F** in a GitHub tab finds text in everything the tab shows, folded diffs included. The
code search button searches the repository's code at the version the tab shows. **Mod-click** a
name in code to go to where it is declared; a right-click also offers **Find references**.

## Asking an agent

With the AI chat on, **Chat about this GitHub item**, or the speech bubble in the tab's header,
starts a chat with a link to the item. **Ask here** does the same for selected lines or words,
quoted. Agents can also read GitHub themselves while the integration is on.

## Page width and people

**Page width** sets how wide a tab's text runs: your notes' line width, a fixed width in pixels, or
the full tab. Code and diffs always take the whole tab. **Show people by** picks names or logins.
Names and pictures are kept on this device for a week; **Kept names and pictures** clears them.
