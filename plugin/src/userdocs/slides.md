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
`quote`. Title, section and quote center their content. Split uses the `::left::` and
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

A notes callout (`> [!notes]`) is kept with the slide but hidden from the audience. It is stored
now for the presenter view planned for a later stage; this stage does not show a notes panel.

A fenced `css` block adds styling to the deck. Or set `theme: "[[sample-theme.css]]"` to use a
CSS file in the vault. Both use the same CSS scoping as script views, limited to this deck's
slides. Imported CSS files are loaded and scoped too, including nested imports; relative files
and pictures are resolved from the importing stylesheet. An import that cannot load does not
remove the rest of your styles. This is selector scoping, not a CSS sandbox; declaration
at-rules behave as in script views. A settings line's `class="sample-layout"` gives the slide
your own class: `.sample-layout` styles that slide, and `.sample-layout h1` its headings. Without your
CSS the fonts, sizes and colors come from Obsidian's theme.

## View and present

The commands **Open presentation**, **Preview presentation beside editor**, and
**Play presentation** are available while a presentation note is active. The source note has
an **Open presentation** header button, and its file menu offers **Edit presentation source**.
Reading mode shows a thin divider with each slide's number and layout instead of its marker.

Use the previous/next buttons, arrows, Page Up/Down or Space to page through the deck. Home and
End go to the first and last slides. Click the slide first if the focus is elsewhere. On a
touch screen, tap the left or right third, or swipe horizontally. Text fields, links, media
and live map or chart controls keep their normal interaction.

**Play** requests fullscreen on desktop and fills the Obsidian window on a phone. The exit
button stays clear of the phone's safe area. **Exit** or Escape returns to the same deck tab.
This is single-screen viewing: presenter windows, steps, transitions, scripts and export are
later stages, not controls in this viewer yet.
