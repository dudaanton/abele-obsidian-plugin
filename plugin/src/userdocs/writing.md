# Writing tools

Galleries, coloured highlights, sidenotes, links to lines, diagrams, charts and maps inside your
notes, and tools for media and bulk edits.

## Image galleries

A line `::abele-gallery::` followed by image or video embeds, one per line, is drawn as a
gallery. **Insert image gallery** starts one at the cursor; **Convert images on page to galleries**
turns runs of images in the note into galleries. The gallery's menu switches between grid,
masonry, column and slider layouts and sets its height. Drop files onto a gallery to add them;
the arrows on a picture move it and the bin removes it. Click one to see it full size, and swipe
through the rest.

## Coloured highlights

`=={red} some text==` highlights text in a colour. **Insert colored highlight** wraps the
selection and lets you pick the colour; **Remove colored highlight** takes it off.

## Footnotes as sidenotes

Footnotes are shown in the margin beside the line that refers to them, when the note is wide
enough. **Reindex footnotes** renumbers them in order of appearance.

## Links to lines

`[[Budget#L12-L18]]` links to lines 12 to 18 of a note. A click opens the note with those lines
selected. **Copy link to selected lines** makes such a link from your selection; the editor's
right-click menu has it as **Copy link to lines**.

## Diagrams

A ```` ```mermaid ```` block is drawn at the width of the note, with zoom and drag, full screen,
and copying as source, SVG or a picture. Turn this off in **Settings → Abele → Other** to get
Obsidian's own drawing back.

## Properties

The properties at the top of a note are drawn by the plugin in a few places:

- A property linking to a wallet, such as a transaction's `from` and `to`, shows what is in the
  wallet today beside the link.
- A number property works out a sum: type `120+35*2`, press Enter, and it keeps `190`. Plus,
  minus, times, divide and brackets.
- A property of type **File** is a card with the file's name and, for a picture, a book or a
  PDF, a small picture of it. **Files** is a list of such cards. Pick the type from the icon
  beside the property name. Press a card to choose another file, the arrow to open it, the cross
  to take it out.
- `cover` is a card too, with the picture on the right.

Nothing about the note changes: it is still ordinary properties, and a device without the plugin
shows them the way Obsidian does. Turn this off in **Settings → Abele → Other**. It rests on
parts of Obsidian that are not meant for plugins; if an Obsidian update changes them, the
properties simply go back to Obsidian's own drawing.

## Charts

**Chart** is a view type for Obsidian Bases: it draws a line, bar or scatter chart from the
properties of the notes a base finds, over a date property or the file name. An `abele-chart`
code block draws a chart from numbers or formulas written in the block itself:

```abele-chart
type: line
x: [0, 10, 0.5]
series:
  - name: Growth
    formula: x^2
```

## Maps

An `abele-map` code block draws a map with points and routes:

```abele-map
points:
  - 56.9496, 24.1052
  - coordinates: 56.951, 24.194
    label: Station
```

A place note keeps its position in the `coordinates` property as `lat, lon`. The maps use free
OpenStreetMap tiles and need no account. A property name and a map style of your own are set in
**Settings → Abele → Other**.

## Find and replace

**Find and replace in frontmatter and content of all notes, matching the criteria** changes many
notes at once: pick the notes by path, name, property or content, then rewrite their text or
their properties. It understands frontmatter rather than treating it as text. The same tool is a
view type in Obsidian Bases, **Find and replace**, which works on the notes a base finds.

## Media

- **Import files to vault** copies files from your computer into the vault.
- **Save remote media to vault** downloads pictures a note links from the web and points the
  note at the copies.
- **Find and delete unused media** lists attachments no note uses.
- **Deduplicate media attachments** finds identical files, keeps the one used most and points
  the links at it.
- **Paste from clipboard at cursor** pastes the clipboard's text as it is.
- **Preview** in a picture's right-click menu opens it full size.

## Code and text files

JSON, CSS, JavaScript, TypeScript, HTML, XML, YAML, CSV and text files open in a code editor with
highlighting. **Open as code** in a file's menu does the same for a file Obsidian opens otherwise.

## Aliases from links

Select text containing links like `[[Anna Smith|Anna]]` and choose **Find and create aliases**
from the right-click menu. Each target note gets the alias it was linked with.
