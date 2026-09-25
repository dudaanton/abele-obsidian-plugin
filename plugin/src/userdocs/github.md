# GitHub

Issues, pull requests, discussions, commits and files from GitHub, opened in Obsidian tabs. It only
reads: nothing is ever written to GitHub.

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
- a folder, with its files and README.

Anything else, such as a release, still goes to the browser.

## Opening by number or name

**Open GitHub link or item** takes a pasted link, `#123`, `owner/repo#123`, a branch, a commit or
words of a title, and suggests matches as you type. A bare number is looked up in the repository
you used last, or in the **Default repository** from the settings.

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
