# Tools

The tool catalogue, grouped as the settings screen groups it, with the distinctions that are
easy to get wrong. Which of these an agent actually has depends on its own tool settings.

## Files

`read`, `write`, `create`, `edit`, `replace`, `edit_selection`, `rm`, `mv`, `cp`, `ls`, `find`,
`open`, `read_image`, `workspace`, `screenshot`, `inspect_view`.

- `edit` replaces one exact string in one file. `replace` applies a list of replacement actions
  and is the one for a bulk, rule-driven change. `write` overwrites the whole file — reach for
  it only when the whole file is being rewritten.
- `create` makes a new file and its parent folders.
- `edit_selection` exists only inside a comment chat on a note. It rewrites the passage that
  comment is anchored to and nothing else in the note; there is no path to give it. A comment on
  a message in a chat does not have it.
- `find` searches by name, property or content and takes structured criteria, not just a word.
- A chat file (`.abchat`) is never in a scope. With the whole vault open, `read` on one returns
  only what was said in it, and `find` matches content against that — never against the log.
- `workspace` says what is open right now; `open` puts a file in front of the person.
- `screenshot` and `inspect_view` take either a `path` (a note) or a `view` (a script view, by
  its tab title or script name). A view is photographed as it is on screen: the visible part
  only, at the person's scroll position, and never a tab that is not showing — the person
  decides what the agent gets to see. Every screenshot is saved to the attachments folder and
  shown in the chat under the tool call, so the person sees the same picture the agent did.
- `rm` moves to trash rather than destroying.

Every one of these is bounded by the agent's scope.

## Vault data

`read_logs`, `read_backlinks`, `read_tasks`, `read_transactions`.

These read the plugin's own structures rather than raw files: the logs shown on a note, what
links to it, the tasks and transactions related to it. Prefer them to reconstructing the same
answer by reading notes and parsing frontmatter — they walk `groups` the way the plugin does,
which a hand-rolled search will not.

## Network

`web_search` (Brave), `fetch`, `download_image`, `download_file`.

`fetch` brings back a page; the vault may hold a skill that teaches a better way of turning one
into markdown. Downloads land in the vault, so they are subject to scope.

## GitHub

`github_views`, `github_read`, `github_pr_files`, `github_file`, `github_commits`,
`github_search`, `github_grep`, `github_open`.

Read-only access to GitHub, offered only while the person has the GitHub integration on. Nothing
on GitHub is ever written — no comment, no review, no label. They send the person's own token to
the server set in the settings, so they see what the person's GitHub tabs see, and a refusal
comes back in the same words the tabs use: the cause, the permission it needed, GitHub's message.

Every item is named by a link or `owner/repo#12`; a repository by `owner/repo` or any link into
it. Answers are capped and say where the rest is — a page, a diff window, a line range. Ask for
the next part rather than trying to get everything at once.

- `github_views` — what the person has open in GitHub tabs: the item, the pull request section in
  front, the diffs drawn open, and the lines they selected, with the code. Start here whenever
  they say "this PR", "this file", "these lines".
- `github_read` — an issue, pull request or discussion: head, description, conversation twenty
  comments a page (`page`).
- `github_pr_files` — a pull request's files. Without `path` the list with +/- counts; with
  `path` that file's diff, numbered on the old and new side, 400 rows by default (`offset`,
  `limit`), and the review comments on it.
- `github_file` — code at a ref (`ref`, the default branch without one): a file's numbered lines,
  600 whole or 400 at a time (`start_line`, `end_line`), a folder's entries, or with
  `recursive: true` the whole tree under `path`. A `blob/…` link names file, ref and lines itself.
- `github_commits` — a pull request's commits (`pull` or its link), one commit's message and diffs
  (`sha` or its link), a comparison (`base` and `head`, or a `compare/a...b` link), or the history
  of `ref`, of one `path` when given. Long diffs are left out and named; ask for one with `path`.
- `github_search` — `type: "code"` searches file contents in GitHub's syntax (needs a token on
  github.com, default branches only); `type: "issues"` searches issues and pull requests
  (`is:pr is:open author:…`). `repo` narrows either to one repository.
- `github_grep` — grep over a repository's code at one exact version: `ref` a branch, tag or
  commit; a pull request (its link or `owner/repo#12`) means its head; nothing means the default
  branch. `query` plain text, `regex: true` a JavaScript regular expression, `case_sensitive`,
  `path` a glob (`src/**/*.ts`, `*.py`); `mode: "names"` lists matching file paths instead. Lines
  come numbered and grouped by file, 100 a page (`offset`, `limit`). The first search of a version
  downloads the repository once for the session — a second or two — and later ones are instant.
  Past the size set in the GitHub settings it is not downloaded and GitHub's code search answers
  instead: default branch only, fragments, no regular expressions, only with a token — the answer
  says so. Binary files and files over 1 MB are not searched. Prefer it to `github_search` for
  code: any branch, exact line numbers, regular expressions, and no token needed for a public
  repository.
- `github_open` — puts something in front of the person in a GitHub tab. `start_line` and
  `end_line` mark lines: with `path` in a pull request's or commit's diff (`old: true` for removed
  lines), or in a file link. It reuses the tab showing the item, else the GitHub tab used last.

Exploring a codebase or a pull request, in this order:

1. `github_views` to learn what they are looking at, and the selection they are asking about.
2. For a pull request: `github_read` for what it claims to do, then `github_pr_files` for the
   list — and only then the diffs of the files that matter, one at a time.
3. For context around a change, `github_file` at the pull request's head or base ref, with a line
   range around the lines in question rather than the whole file.
4. For an unknown repository: `github_file` with `recursive: true` for its map, the README, then
   `github_grep` for where a name is defined or used (`github_search` when the repository is too
   big to download).
5. When the answer is a place in the code, link it — GitHub's own address with `#L10-L20`, or
   show it with `github_open` — so the person can open it in a tab with one click.

Unauthenticated, GitHub allows 60 requests an hour for the whole machine; spend them on the parts
that answer the question.

## Maps

`geocode`, `places`, `route`.

Addresses, places and journeys, from OpenStreetMap through services that need no key and no
account: Photon for search, Overpass for what stands around a point, Valhalla for routes with
OSRM behind it. They are on unless someone turned them off, so there is nothing to set up before
asking where something is.

- `geocode` goes both ways: `query` for an address or a place name, `lat` and `lon` for the
  address at a position. `near` biases an ambiguous name towards a city or a point.
- `places` finds what is around a point — `near` takes an address, a place name or `lat, lon`,
  `query` takes a category (`cafe`, `pharmacy`, `museum`, or a raw OSM tag like `amenity:cafe`)
  or free text. A category asks the map what is really there, within `radius_km` (2 km by
  default, widened once when that circle is empty); free text searches names instead, which is
  the weaker answer — prefer a category where there is one. Results are sorted by distance.
- `route` takes `from`, `to`, any number of `via` points, and a `mode` of `car`, `bike` or
  `walk`. It answers with the distance, the time and the turn-by-turn directions.

Coordinates come back as `lat, lon`, rounded to five decimals. Which property they go in is the
person's: `mapCoordinatesProperty` in the settings says which one this vault uses, the answers
name it, and `read_settings` reads it. The format is the same either way, and it is what both
the `abele-map` block and Obsidian's own map layout read.

Every one of the three also draws its answer: the chat shows the places, or the line of the
route, on a map under the tool call. The same map goes into a note as a block:

```abele-map
height: 320
points:
  - 56.9496, 24.1052
  - coordinates: 56.951, 24.194
    label: Station
  - location: 56.946, 24.111
    label: Hotel
    color: "#e5484d"
```

`center` and `zoom` fix the view instead of fitting it to what is on the map, `style` takes a
MapLibre style URL, and `interactive: false` makes a picture rather than something to explore.
Interactive maps have zoom, compass, fullscreen and scale controls. Pressing a place already
labelled by the base map shows its details; pressing a building or an unlabelled point resolves
the nearest address and coordinates. A route is drawn by handing over the encoded line the routing service returned — `route`, with
`routePrecision: 6` for Valhalla and `5` for OSRM — which is what the chat does for `route`.
Nothing about the block needs the network except the tiles.

These are public services run on donations. They are asked one request at a time, about a second
apart, and repeat answers come from memory rather than the network — so a long batch of lookups
takes as long as it takes rather than getting the person's address blocked.

## AI

`generate_image`, `edit_image`, `eval_js`, `questions`, `delegate`, `remember`.

`questions` is how to ask the person something and get a structured answer back rather than
guessing. `eval_js` runs JavaScript inside Obsidian — powerful and easy to misuse; for anything
meant to be repeated, write a script instead (see the `scripts` section).

`remember` saves one short line to your own memory — yours, not other agents' — which is shown
to you in every later conversation. Use it only when the person asks you to remember something,
and write the gist in one line, at most 200 characters: a fact or a preference, not a note. A
longer one is refused; shorten it and call again. Memory is not a place for work in progress —
that belongs in the vault. There is no tool to forget: the person removes items in the agent's
settings, under Memory, so when they ask you to forget something, tell them where.

## Templates

`list_templates`, `apply_template`, `skill`.

## Docs

`template_docs`, `chart_docs`, `script_api_docs`, and this reference itself, `query_docs`.

Fetch the reference before writing the thing it describes. The script API and the template
syntax both have details that cannot be guessed.

## Scripts

`create_script`, `answer_form`, plus one tool per script the vault has, named `script_<name>`.
A script the person has written is a tool an agent can call by name, with its declared
parameters.

A script may stop partway and ask for more than its parameters — a form the person would fill
in. Called from a chat there is nobody to show that form to, so it comes back instead: the
script tool answers with the fields and a `run_id`, and the run stays alive holding the question
open. Send the answers with `answer_form` — `values` is a JSON object keyed by field name — and
the script goes on from where it stopped, and may finish or ask again. Anything in the form that
is the person's to decide is worth asking them about first, with `questions`. `cancel` tells the
script nobody is answering, which is what dismissing its dialog would have done.

## Settings

`read_settings`, `write_settings`.

The plugin's own settings, read and changed one key at a time. `read_settings` with no
arguments lists them all; with a `path` it returns one. `write_settings` changes exactly one,
and the setting has to exist already and keep its type. Keys, keychain ids and the chat index
are neither readable nor writable.

Each carries its own mode, so reading the settings and changing them are two permissions. What
each setting decides is the `settings` section of this reference.
