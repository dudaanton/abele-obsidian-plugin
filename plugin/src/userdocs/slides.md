# Presentations

An ordinary note can be a slide deck. Write its slides in Markdown, view them in a tab, then
show the same deck across the whole window. The slides use your Obsidian theme and all the
pictures, diagrams, galleries, charts and maps you already put in notes.

## Make a deck

Give the note the property `type: presentation`. Opening it from a link or the file explorer
now opens the deck. Use **Edit source** to return to its text, or **Edit beside** to keep an
editor next to the slides. Changes refresh the preview on the slide you are looking at.

```markdown
---
type: presentation
aspect: '16:9'
---

::slide{layout=title}::

# Sample deck

A short introduction

---

::slide{layout=split}::

## Two sides

::left::

- First point
- Second point
  ::right::
  ![[sample-image.png]]

> [!notes]
> A private reminder for the speaker.
```

A line containing just `---` starts the next slide. The property fences and code examples do
not split slides. For a horizontal line within a slide, write `***` instead. A note written
for Obsidian's built-in Slides uses the same separator; its own Slides command stays separate.

## Choose a layout

A settings line is optional and goes at the very top of its slide:
`::slide{layout=content}::`. Choose `title`, `section`, `content`, `split`, `grid`, `image` or
`quote`. Title, section and quote center their content. The default style uses large slide
text and a clear heading hierarchy, with your theme's accent for subheadings and emphasis,
comfortable tables and bordered quotations. Title slides have a larger heading and muted subtitle. Split uses the `::left::` and
`::right::` lines for columns. Grid uses one `::cell::` line for each cell. Image fills the
slide with its embedded image or video and leaves the text as a caption.

The slide is a fixed canvas, scaled to fit rather than reflowed. `aspect: '16:9'` is the
usual widescreen shape. `4:3` and `9:16` are also available. On a phone, turn it sideways to
make a widescreen deck larger. If text does not fit, shorten it or split it across slides.

## Pictures, video and backgrounds

Embed pictures and videos exactly as in a note. Drawings, galleries, Mermaid diagrams, charts
and maps work the same way too. A background goes in the settings line, for example
`::slide{bg="[[sample-image.png]]" dim=0.4 fit=cover}::`. Use `fit=contain` to keep the whole
picture; `cover` fills the canvas. `dim` adds a wash of the theme's background color.

A video background uses the same `bg` setting. Add `autoplay` to try playing videos on entry.
Automatic playback is muted and stays within the slide on phones. If the device refuses it,
**Play video** lets you start it manually; the video's own controls are also available. Leaving
a slide pauses its video and audio. Tap media or live controls without turning the slide.

## Notes and your own CSS

A notes callout (`> [!notes]`) is kept with the slide but hidden from the audience. The presenter
view shows it in your notes panel, using the same formatting as a note.

Put source links in that notes callout too, for example:

```markdown
> [!notes]
> Supporting detail for the speaker.
> [Report](https://example.test/report)
> [[Sample reference|Reference]]
```

The deck automatically adds a final **Sources** slide, grouped by slide title, and a small
**Sources: N** label on each slide with references. Notes still show these links. Repeated
links on the same slide count once; pictures and code examples are not collected. Use ordinary
Markdown links (including reference links), note links or angle-bracket web links in notes.
The last slide is not written into your note: change the references in the original notes
rather than trying to edit the generated slide. A very long source list may overflow;
check the final slide too.

A fenced `css` block adds styling to the deck. Or set `theme: "[[sample-theme.css]]"` to use a
CSS file in the vault. Both use the same CSS scoping as script views, limited to this deck's
slides. Imported CSS files are loaded and scoped too, including nested imports; relative files
and pictures are resolved from the importing stylesheet. An import that cannot load does not
remove the rest of your styles. This is selector scoping, not a CSS sandbox; declaration
at-rules behave as in script views. A settings line's `class="sample-layout"` gives the slide
your own class: `.sample-layout` styles that slide, and `.sample-layout h1` its headings. Without your
CSS the fonts, sizes and colors come from Obsidian's theme.

## Live scripts and HTML

A `slide-script` block names an existing script from your configured scripts folder; it cannot
contain JavaScript of its own. Example:

```slide-script
script: Sample report
params: { region: west }
refresh: enter
```

The script's declared parameter defaults apply. It runs through the same script service and
foreign-script confirmation as a note button. Its returned text appears on the slide, and
`show(markdown)` renders formatted content there instead of opening a dialog. For
interactive cards, tables and buttons it may build a `view()` and call `open()` — the component
kit renders inside the slide instead of opening a tab. `refresh: once` (default) runs once per
entry without a timer, `enter` rebuilds it on each entry, and `refresh: 60s` reruns it while
visible. Live script views are rebuilt when you return because leaving disposes their buttons,
timers and handlers. Scripts are not started in presenter previews; only the audience slide
runs them. Closing or leaving aborts the run and disposes its view. As with any script, JavaScript
it writes outside the script API (such as a raw global timer) cannot be forcibly cancelled; use
`view.every()` and `signal` for work that must stop.

A `slide-html` block is a complete interactive HTML fragment:

```slide-html
<button onclick="this.textContent = 'Clicked'">Click</button>
```

It is shown in a **sandboxed, opaque-origin iframe**, not in the note or Obsidian. It cannot
read the vault, plugin state, parent DOM or Obsidian's cookies; it cannot open popups or submit
forms. The frame is destroyed on exit and recreated on reentry, stopping its animation, timers
and audio. Presenter previews never start it.

**Offline means static HTML only on desktop and phone.** The slide labels this mode explicitly.
Scripts are disabled by the sandbox and CSP; script tags, event handlers, links, refresh redirects,
forms, SVG, and nested documents are removed before the frame is created. Basic text, tables,
inline CSS (including CSS animation), and base64 image/audio/video data remain. Remote resources
are blocked by CSP. JavaScript interaction requires network permission, even if your script would
not intentionally use the network: a script can navigate its own iframe, which CSP alone cannot
reliably block. Vault paths are **not** resolved or inlined; use regular Markdown embeds outside
the frame instead.

To enable interactive HTML, set `htmlNetwork: true` in frontmatter. The first time on each device
and vault, the presentation asks **Allow network**; the answer (including refusal or dismissal)
is remembered for that deck. All HTML blocks share that decision. The initial document's CSP
allows HTTPS resources, but an interactive frame can navigate to other web pages and those pages
have their own network policy. This permission therefore allows network use, not just HTTPS
fetches. The frame stays sandboxed and cannot read your vault, but it can send any data you put
inside it to websites. Only enable it for HTML you trust.

## Ask an agent to make a deck

Ask an agent to turn a note into a presentation. In that agent's tools, enable the
**Presentations** tools: **Read deck**, **Create deck**, **Edit slide**, **Check deck fit** and,
if you want it to open the result, **Open presentation**. Enable **Screenshot** too so it can
see the slides rather than only guessing from text. Each tool has its own Off/Ask/On choice;
new deck tools start Off. Creating or changing slides uses the usual write preview and approval.
Even with general writes allowed, a deck tool set to Ask still asks.

The agent can read slide structure and speaker notes, build a deck in a new note, replace a
slide, insert one or remove one. Long decks are read in small pages, so large speaker notes or
inline images do not flood a model's context; the agent must finish reading the current deck
before editing it. Its fit check measures text and media against the full slide
canvas, not the phone-sized view. It flags overflow, clipped or missing pictures and unusually
dense text. It separately warns about more than 40 body words, 5 list items, tables larger
than 5 data rows by 3 columns, more than two body links, visible web addresses, and custom
fonts or literal colours in deck CSS. The agent should fix these warnings or explain why
it kept them. Sources are collected into the final slide rather than cluttering slide bodies.
Its screenshot shows the complete slide in your current theme, with all list steps
visible, but without speaker notes. Pictures are saved in your usual attachments folder and
shown in the chat, so you can see what the agent saw.

The recommended workflow is in the agent's presentation reference: read the source note,
outline one idea per slide, create the deck, check every slide, look at its picture, then revise
and check again. The source note stays unchanged unless you ask otherwise.

Keep about 40 body words and at most five bullets per slide; move detail and sources into
speaker notes or split the slide. Built-in layouts and your Obsidian theme are the default;
the agent should only write custom CSS, colours or fonts when you ask.

A title-and-four-slide starting template and a reusable **Make a presentation** skill are provided as copyable examples
in the repository's `docs/examples/`; they use the normal [Templates](templates) and skills
system. The workflow is also available to any agent through its built-in reference without
installing a skill note. Nothing is added to your vault automatically.

**Live content is not checked by an agent preview.** Scripts and HTML are labelled placeholders;
other plugins' executable blocks are inert. The agent can write named-script and HTML blocks,
but cannot confirm a foreign script or allow HTML network access. Check those slides in a show
you start yourself. Opening a normal deck with **Open presentation** can activate its trusted
live content, but the tool cannot answer its network permission prompt for you.

## View and present

The commands **Open presentation**, **Preview presentation beside editor**, and
**Play presentation** are available while a presentation note is active. The source note has
an **Open presentation** header button, and its file menu offers **Edit presentation source**.
Reading mode shows a thin divider with each slide's number and layout instead of its marker.

Use the previous/next buttons, arrows, Page Up/Down or Space to page through the deck. Home and
End go to the first and last slides. Click the slide first if the focus is elsewhere. On a
touch screen, tap the left or right third, or swipe horizontally. Text fields, links, media
and live map or chart controls keep their normal interaction.

**Play** enters native fullscreen on desktop and covers Obsidian's interface on a phone.
On supported phones it also hides the system status bar, restoring it when you leave.
Only the slide stays on screen: controls are hidden until you hover over the **top strip**
on desktop or tap an empty slide area on a phone. They fade away a couple of seconds after
you leave the strip or stop tapping. Moving the pointer over the slide does not reveal them.
Tab also reveals the controls for keyboard access. The controls overlay the slide without
moving it and stay clear of the phone's safe areas. **Exit** or Escape returns to the same
deck tab. On a phone, switching tabs, opening another file or navigating to another panel
also ends the show and restores the system status bar. Use Play when you want a single-screen
show.

## Present with notes

Choose **Present** in the deck or the command **Present with speaker view**. On a computer,
this opens a second Obsidian window for the audience. Move that window to your projector or
second display, then hover over its top strip and click **Fullscreen** there. The audience
controls hide just as in Play; the movable window deliberately starts without fullscreen.
Your original tab keeps the current and next
slides, your private speaker notes, a slide selector and a timer. Use **Pause timer** to pause
or resume the clock, and **Reset timer** to start it again. Preview videos stay paused so they
do not play twice; the audience slide keeps its usual playback controls.

Arrows, Page Up/Down and Space from either window drive the same show. **End show**, **Exit**,
Escape or closing either presentation view ends it and closes the audience window. Your deck
returns to a normal tab, on the slide where you stopped. Editing the source beside the deck
also updates both windows and the speaker notes.

On a phone, **Present** shows these controls on the phone itself without a second window.
During **Play**, you can also hold an empty slide area briefly and release to open your notes
and previews. This is a local presenter, not a remote control for a computer on another device.
The controls and notes stay clear of the screen's safe areas.

## Reveal items and choose transitions

Add `steps` to a slide's settings line, for example `::slide{steps}::`, to reveal its list items
one by one. Nested items appear with their parent. Next or Space reveals an item before moving
to the next slide. Previous hides an item, then returns to the previous slide with its items
shown. Selecting a slide directly starts it unrevealed. The next-slide preview shows the full
list so you can see what is coming.

Set the deck property `transition: fade` or `transition: slide` for a simple slide-entry
animation. `none` is the default. A slide can override it with `::slide{transition=none}::`.
Animations last a quarter of a second and turn off when the system requests reduced motion.
Export is a later stage.
