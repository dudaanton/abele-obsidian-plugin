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
- `edit_selection` exists only inside a comment chat. It rewrites the passage that comment is
  anchored to and nothing else in the note; there is no path to give it.
- `find` searches by name, property or content and takes structured criteria, not just a word.
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

Coordinates are written as `lat, lon` rounded to five decimals, which is what a note stores and
what a map layout reads: `location: "56.9496, 24.1052"`. Write a place into frontmatter that way
and it needs nothing else to appear on a map.

These are public services run on donations. They are asked one request at a time, about a second
apart, and repeat answers come from memory rather than the network — so a long batch of lookups
takes as long as it takes rather than getting the person's address blocked.

## AI

`generate_image`, `edit_image`, `eval_js`, `questions`, `delegate`.

`questions` is how to ask the person something and get a structured answer back rather than
guessing. `eval_js` runs JavaScript inside Obsidian — powerful and easy to misuse; for anything
meant to be repeated, write a script instead (see the `scripts` section).

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
