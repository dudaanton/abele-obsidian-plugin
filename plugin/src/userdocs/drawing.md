# Drawing

A canvas with no edges to draw on with a pen, a finger or the mouse. A drawing is an ordinary
SVG picture in your vault, so a note shows it with or without the plugin, on any device.

## A new drawing

**New drawing** in the command palette makes one where new notes go, and **New Abele drawing**
in a folder's menu in the file explorer makes one in that folder. The folder action names Abele
so it stays distinct from other drawing plugins' actions. It opens ready to draw on. Clicking a
drawing anywhere — the file explorer, a link, the quick switcher — opens it in its own tab again;
every other SVG opens in Obsidian's picture view as before.

## Drawing

The first button of the bar over the drawing turns drawing on; in the same place, the tick turns
it off. While drawing is on, the drawing takes every touch: Obsidian's swipes, menus and long
presses do not answer there.

- **Pen** — the harder a pen presses, the wider the line.
- **Marker** — a wide see-through line, like a highlighter.
- **Eraser** — takes away every whole line it touches. The eraser end of a pen erases too.
- The dots pick the colour, the wavy line how thick the pen and the marker draw: fine, medium or
  bold. The thickness is kept for every drawing, and is also under **Pen thickness on drawings** in
  **Settings → Abele → Books**.
- Undo and redo take back and bring again one line, or one whole pass of the eraser;
  Ctrl or ⌘+Z and Ctrl or ⌘+Shift+Z do the same.
- Esc turns drawing off.

On a tablet the pen draws and a finger moves the drawing; a hand resting on the screen while the
pen draws is ignored. On a phone, which has no pen, a finger draws — the hand button switches
that.

## Picking out, moving and resizing

The **lasso** picks what you draw round — a line when most of it is inside the loop. A tap picks
the one thing under it. What is picked gets a box: drag inside it to move it, drag the dot at its
corner to make it larger or smaller, lines and letters with it. While something is picked, a
colour recolours it and the bin, Delete or Backspace take it away. Esc lets go of it.

## Shapes and text

The **shape** button draws a box, an ellipse, a line or an arrow by dragging from one corner to
the other; tap the button again to choose which. The shapes take the pen's colour and
thickness.

The **text** button: tap where the text goes and type. On an iPad you can write into it with the
pen and it turns into text. Tap a text already there to change it; empty it to take it away. The
thickness picks the size of new text.

## Notes on a drawing

**Add a note to the drawing** in the menu at the end of the bar, or drag a note from the file
explorer onto the drawing, and the note shows there as a card — the note itself, as it reads,
kept up to date as it changes. Draw over it, pick it with the lasso to move it or make it larger
(its text grows with it), or take it off the drawing. With drawing off, a tap on a card opens the
note. Anywhere without the plugin the card shows as a box with the note's name.

## Moving around

A finger, the mouse or the wheel moves the drawing; two fingers, a trackpad's pinch or Ctrl or ⌘
with the wheel zoom it. While drawing is on, the middle mouse button drags. The percentage in the
bar opens the zoom: in, out, actual size, or the whole drawing.

## In a note

**Insert a new drawing** — in the command palette or the editor's right-click menu — makes a
drawing beside the note's attachments, shows it in the note where the cursor is, and opens it
beside the note to draw on. It goes into the note as the picture's own embed, nothing round it:

```markdown
![[Sketch.svg]]
```

Once a part of it is chosen, the link names that part — `![[Sketch.svg#part=120,40,800,500]]` —
and without it the note shows all of it. A size after a bar works as for any picture. Notes
written with an earlier version show a drawing in a `[!drawing]` callout; those keep working.

Its buttons show in the corner of the picture when the pointer is over it; on a phone or a tablet,
tap the picture once to show them (that tap does nothing else), and they go again after a few
seconds or a tap elsewhere. The arrow opens the drawing. The pen opens the drawing at that part to
draw on. The other one changes the part: drag to move it, pinch, use the wheel with Ctrl or ⌘, or
the trackpad to zoom, then the tick to keep it (the cross leaves it as it was). Without the plugin,
the note still shows the whole drawing.

To show a part of a drawing in another note, move to it in the drawing's tab and choose **Copy
embed of what shows** from the menu at the end of the bar; paste it into the note. A drawing's
menu in the file explorer copies one that shows all of it.

## Pictures and the agent

The menu at the end of the bar exports the drawing as a PNG beside it, or copies it as a
picture to paste anywhere. With something picked by the lasso, only that part goes.

The same menu hands the drawing to the AI agent: **Ask the agent about the drawing** opens a new
chat with the question begun, and **Transcribe the handwriting** asks for what is written as text.
Pick a part first to ask about only that part. Nothing is sent until you send it.

To put the drawing into the chat you are already in, use the paperclip in the tab's header, or
**Attach the drawing to the chat as a picture** in the same menu. It goes as a PNG, saved where
the vault keeps attachments, into what you are writing in the chat in front — only the part
picked by the lasso, when something is picked. The agent can
also look at a drawing whenever you ask it to in a chat, all of it or a part, and closer when
the writing is small.

## Drawing on pictures

A picture in the vault — PNG, JPEG, WebP, GIF or BMP — opens in a tab with the same tools, the
picture under the ink, from wherever you are looking at it:

- a picture open in its own tab: the pen in the tab's header, or **Draw on this picture** in the
  tab's menu;
- a picture shown in a note, in reading view or while editing: right-click it and choose **Draw
  on this picture**. On a phone, long-press it while editing the note — in reading view a long
  press gets the phone's own picture menu;
- the full-screen picture viewer of a gallery: the **Draw** button under the picture;
- the file explorer: **Draw on this picture** in the picture's menu;
- the chat: right-click a picture the agent made or showed, or one you attached, and choose
  **Draw on it**.

A picture on the web, not in the vault, cannot be drawn on.

The picture stays as it is until you choose, in the menu at the end of the bar, what becomes of
it: **Save over the picture** (asked about first), **Save as a new picture** beside it, or **Send
back to the chat**, which saves a new picture and attaches it to what you are writing there.
Begun from a picture shown in a note, there is also **Save as a new picture and replace it in the
note**: the new picture is saved beside the original, and that one place in the note shows it
instead, written the way it was — its size and caption kept. The original picture stays in the
vault. If the note has changed meanwhile so that the place cannot be found for certain, the new
picture is still saved and the note is left as it is; a message says so. A
picture that cannot be written in its own kind — GIF, BMP — is saved as a new PNG. Closing the tab
without saving keeps nothing.

## Canvas diagrams

Structured diagrams stay ordinary `.canvas` files, separate from SVG drawings. Ask an agent to
build a diagram, lay it out, and define a short walkthrough: an overview, then a few new cards
per step, with an explanation and a camera focus. It can refine cards and connections by their
stable names and check the result as pictures and a list of layout warnings. Canvas write tools
have independent per-agent Off/Ask/On permissions; creating, editing, laying out and defining
steps default to Ask. Reading and inspecting pictures default to On, within the chat's scope.

**Open current canvas in diagram viewer** opens the active canvas in Abele. Canvases use this
viewer by default; **Settings → Abele → Other → Open canvases in Abele** chooses the default.
**Open in Obsidian Canvas** in the viewer's header returns that tab to the native editor and
keeps it there. A file's context menu offers **Open in Abele** to return to the viewer. The
viewer now lets you create and edit cards by hand. Moving or resizing cards still happens in
native Canvas or through the agent. Viewing, panning and playing steps never save changes into
the diagram.

Abele's **New canvas** in the command palette, or **New Abele canvas** in a folder's menu,
creates an empty diagram. Its
bar offers **Text**, **File** (an Obsidian picker for a note or attachment), and **Link** (a web
address). New cards appear near the centre of the current view. Tap a card to select it; **Edit
text** edits a text card, while **Open** opens a linked note, attachment or web page separately.
Editing a text card never edits the contents of a linked note.

**Save text** completes one change, including creating a new text card. Until then, typing and
IME composition are drafts, not writes. **Keep draft** leaves the text unsaved in this running
session. **Delete**, **Undo** and **Redo** work on cards and the shared history, including agent
changes. Outside a text field, Delete/Backspace deletes a selected card, Enter edits its text,
and Ctrl or ⌘+Z / Shift+Z undo and redo. Inside fields those keys belong to the text input.
Two Abele tabs share the same content and history, but keep their own selection and camera;
an active text edit prevents another tab or agent from publishing over it.

A failed save keeps the text visible and explicitly marked unsaved. **Retry save** is available
only when the write is known not to have happened and the original source is unchanged. Source
changes or renaming the canvas block retry; there is no whole-draft overwrite of newer content.
**Discard draft…** asks before forgetting only local unsaved work, without restoring the file.
Closing and reopening retains pending work in memory, not across a plugin reload or crash.

Returning to **Open in Obsidian Canvas** with pending work asks you to stay, explicitly retain
it in memory while opening the saved source, or discard it. Retaining does not save the draft;
native changes (even a formatting-only save) can block retry. A failed Undo/Redo leaves a
local history preview: explicitly discard that preview before trying Undo/Redo again, rather
than saving it as a new text change. Failed agent proposals and uncertain writes still use the
separate recovery/review action below for discard. No native pending save is silently cancelled.

Use **Play**, then the arrow buttons, Right/Left or Space to move through steps. On a phone,
swipe horizontally on the diagram or tap an empty area to go forward. **All** or Escape shows
the complete diagram; **Fit** frames it again. Drag to pan and pinch to zoom; Ctrl or ⌘ with
the wheel also zooms. Each step reveals more of the diagram, highlights the important parts,
and puts its explanation below the picture. Longer explanations scroll above the phone's
navigation. Going backwards hides later cards again. A linked note shows its live content;
select it and use **Open** to open the note. During a walkthrough, tapping a linked card opens
it directly. A linked sub-diagram opens its own viewer.

### A canvas change that did not finish

Use **Recover failed canvas change** in the viewer's header. A change known not to have been
written keeps its existing Retry, Reapply, and Discard choices. If the write outcome is uncertain,
or writing succeeded but local acknowledgment did not finish, the action instead opens a local
read-only review: current persisted file, retained proposed draft, and original baseline are
shown separately. Native unsaved edits are not labelled as saved file contents.

**Keep retained work**, closing, or cancelling leaves the work and evidence intact.
**Discard local pending copy…** asks first: this only forgets that pending copy and unresolved
attempt evidence in this running session. It does not undo changes already written to the file,
write or restore any file contents, or add the missing acknowledgment/history entry. The file
may already contain the change; matching contents do not establish that the attempt succeeded.

After discarding, reread the current diagram. Ask for any still-desired difference as a new
ordinary edit, not replay of the old attempt. This review is not automatic settlement,
and retained work does not survive a plugin reload or crash.

## A diagram inside a note

Embed a canvas as usual, or name a one-based step or a card:

```markdown
![[sample.canvas]]
![[sample.canvas#step=2]]
![[sample.canvas#node=alpha]]
```

Reading view and Live Preview show a static picture with **Open** and **Play** buttons.
The step's explanation appears below its picture. Open goes to the named view; Play begins
at the named step (the first step when no step is named). Pictures follow changes to the
source. Scrolling the surrounding note is still the note's gesture, not canvas panning.
Without Abele, Obsidian can still open and embed the ordinary canvas, without the walkthrough.

The picture action in the viewer's header exports the current diagram view, or every step,
as PNG or SVG into the vault's ordinary attachments folder. SVG is a self-contained picture
with embedded PNG pixels, not editable vector shapes. PDF export and human drawing tools on
these diagrams are not available yet. SVG drawings retain their existing pen tools and export.

## Where it is kept

The drawing is saved a moment after you stop, when drawing is turned off and when the tab
closes. The file holds the picture as any app shows it and, inside it, every line with the
points it went through, so the plugin opens it again for drawing. A change made on another
device appears in an open drawing as it arrives.
