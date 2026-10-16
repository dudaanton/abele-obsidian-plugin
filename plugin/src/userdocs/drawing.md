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
the vault keeps attachments, into what you are writing in the chat in front (or a new chat,
when none is open) — only the part picked by the lasso, when something is picked. The agent can
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

### Import Excalidraw drawings

**Migrate this Excalidraw drawing to a canvas** makes a new canvas beside the active drawing.
The drawing's file menu also offers **Migrate to Abele canvas**.
**Migrate all Excalidraw drawings to canvases** asks with the number of drawings first, then shows each result and
anything that could not carry over. Existing files stay untouched; a name already in use gets
a numeric suffix. Drawings already migrated are skipped.

Compressed or plain JSON drawings in notes and `.excalidraw` JSON files are supported.
Shapes, text, arrows, pen strokes, frames and pictures become canvas cards, connections, ink
and groups. Sketchy strokes, fills, fonts, rotation, locking and grouping do not carry over
exactly; the report lists losses. Nested drawings stay file references. An agent can also
migrate one drawing or all drawings within its scope.

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
viewer lets you create, edit, move, resize and group cards by hand. Viewing, panning and
playing steps never save changes into the diagram.

Abele's **New canvas** in the command palette, or **New Abele canvas** in a folder's menu,
creates an empty diagram.

### The tools

A row of tools runs across the top of the canvas tab, as over a drawing: **Select** (V) and
**Hand** (H, or hold Space); **Card** (T), **Note or file** (N), **Web page** (W), a **Shape**
(R), **Connect** (A, with **Line** and **Arrow** in its family) and **Frame** (F); then **Pen**
and **Marker** (P), the **Eraser** for whole strokes or part of one (E), and the **Lasso** (L).
Pressing the tool already in hand offers the rest of its family. With a pen in hand its colours
and width stand in the same row. Zoom, fit and Undo/Redo stand in a column at the top right; on
a phone two fingers zoom and the column keeps only Undo and Redo, and the tools that do not fit
wait under **More tools**. A dot in that column says when a change could not be saved, and
opens Retry or Discard the draft.

**Select** picks with a click; Shift-click adds or takes away. Dragging over empty canvas with
the mouse draws a box and picks everything wholly inside it; a finger there moves the canvas.
Over what is picked stands a small bar of its actions: colour, shape, Edit text or Open, the
arrows and line of a connection, attaching or detaching strokes, **Frame these**, **Pick
several** (each press on a card then adds or takes it away, for screens with no Shift) and
**More**. Delete removes the picked things; arrows move them a step (ten with Shift); Cmd+D
makes a copy beside them, Cmd+C copies them, Cmd+A picks everything, Cmd+] and Cmd+[ bring
them to the front or send them back, Shift+1 shows the whole canvas and Shift+2 what is picked.

A double click or double tap opens what it lands on: a card's words, a connection's label
written where it stands, a frame's name; on empty canvas it makes a card there. Esc, or a press
anywhere on the canvas, leaves the words saved.

**More** offers, in the same order for every kind: Duplicate and Copy; Bring to front and Send
to back; **Pin in place** (a pinned card is picked but not carried or resized until it is
unpinned); Turn into a note (a text card's words become a note standing in its place); for a
note, **Show a part of the note…** (a heading or a named block, or all of it); Attach to the
chat as a picture and Ask the agent about this; Export the selection as a picture and Copy
embed of the selection; and last, in red, Delete. A note or web page is only **Removed from
canvas**; **Delete the note…** asks first and takes the note itself to the trash. A frame offers
Duplicate with what is inside, Export frame, Copy embed of this frame and Delete frame and what
is inside. Strokes offer **Read the handwriting**, which asks the agent to write them out.

The tab's own **⋯** menu adds **Find on the canvas** (Cmd+F), **Show contents** (its frames and
walkthrough steps), **Export…**, **Copy embed of what is shown**, **Open in Obsidian Canvas**
and, on a tablet, **Draw with a finger**. The image-plus action in the tab's header attaches the
whole canvas to the chat as a picture; the paperclip attaches the canvas file to a chat.

### Cards, frames and connections

Drag a card to move it; a picked card has four corner handles to resize it, without changing a
linked note's contents. A note on the canvas reads on under the mouse wheel before the canvas
moves. Editing a text card never edits a linked note.

**Frame** draws a frame around cards: drag around them, or click for one of ordinary size. Its
name is asked for at once on the label over its corner. A picked frame can be renamed, folded
to a dashed edge with the count hidden, or removed while keeping what is inside. A card carried
over a frame lights the one it would land in.

Each card shows a point in the middle of every edge under the mouse or when picked. Pull a
connection from a point to another card: it sticks to the edge of that card nearest the
pointer. Let go over nothing and a menu there offers a **Card**, a **Note or file** or the
last **Shape**, made at the end of the connection and joined to it. **Connect** also joins two
cards by dragging from one to the other. **Line** and **Arrow** draw free primitives. Drag a
picked connection's end to reconnect it. Moving or resizing cards keeps their connections.

**Paste** puts what was copied where the pointer is: a picture is saved with the vault's
attachments and stands as a card in its proportions, an address becomes a web page card,
cards copied from a canvas come back as copies with their connections, and words become a card.

### Drawing on a canvas

**Pen** and **Marker** draw with the mouse, a finger or a pen, in the ordinary Canvas colours
and fine, medium or bold. Start over a card or frame to attach the stroke to it: a dashed
outline shows the attachment while you draw; starting on empty background makes free ink.
Attached ink follows its card when it moves and stretches with it. Each finished stroke is one
Undo item. A stroke drawn while the last one is still being saved is kept and saved after it.

On a tablet a Pencil draws whatever tool is in hand and erases with its other end; once it has
touched the canvas a finger moves the canvas instead of drawing, unless **Draw with a finger**
is on, and a hand resting on the screen is let go of when the pen lands. A pen never moves the
canvas. Two fingers tapped together undo; three redo. Two fingers moving interrupt drawing and
switch to pan and pinch without saving a partial stroke.

**Eraser** removes whole strokes it passes over, or with **part of a stroke** cuts away only
the part touched. One sweep is one Undo item. **Lasso** circles both ink and cards; a tap picks
one stroke or card. Drag inside the lassoed selection to move it, or its bottom-right corner to
scale it. Detaching makes annotations independent; attaching binds free strokes to the card
picked with them, or the one under them. Grouping free ink attaches it to the new frame;
removing the frame keeps its ink as independent strokes.

The agent can read your strokes, change their points, colour or thickness, move or scale them,
attach or detach them, erase them, restack cards and connections, and add its own pen or marker
strokes. You edit those strokes with the same tools. An agent batch is one shared Undo item;
your unfinished gesture or text draft blocks it instead of being saved by the agent. Editing
still uses the agent's own Ask permission. Walkthroughs can focus and highlight strokes by name.

Each finished drag or resize is one shared undo item. Until release the geometry is only a
preview; an agent or another tab cannot publish over the active gesture. Escape, a cancelled
touch, or Fit cancels the preview. Adding a second finger cancels a card move or resize and
switches to pan and pinch, without saving an accidental move.

Card text saves itself, like a note: there is no save button. About a second after you stop
typing, the text so far is written to the file and becomes one Undo item; while you keep typing it
is written every few seconds. Leaving the field, closing the tab, switching files or opening native
Canvas writes it at once, and so does an agent reading the canvas. IME composition is never written
half-finished. Tap the canvas, or press Escape or Cmd+Enter, to finish editing the card. If a
write fails, the canvas says so and offers **Retry save** and **Discard draft…**; leaving the field
or the app then waits for your choice instead of writing. Nothing else asks you to save.
**Delete**, **Undo** and **Redo** work on cards and the shared history, including agent
changes. Opening a card's text and leaving it unchanged writes nothing and keeps redo available.
If the shared history changes while an Undo/Redo click is waiting, the action is refused;
read the updated diagram and try again. Outside a text field, Delete/Backspace deletes a selected card, Enter edits its text,
and Ctrl or ⌘+Z / Shift+Z undo and redo. Inside fields those keys belong to the text input.
Two Abele tabs share the same content and history, but keep their own selection and camera;
an active text edit prevents another tab or agent from publishing over it.

A failed save keeps the changed text or geometry visible and explicitly marked unsaved. **Retry save** is available
only when the write is known not to have happened and the original source is unchanged. Source
changes or renaming the canvas block retry; there is no whole-draft overwrite of newer content.
**Discard draft…** asks before forgetting only local unsaved work, without restoring the file.
Closing and reopening retains pending work in memory, not across a plugin reload or crash.

Renaming or moving linked notes, images, drawings, or their folders uses Obsidian's own link
updates, including group backgrounds. Abele waits for those updates before saving pending
work. If only standard file references changed, pending cards and Undo/Redo follow the new
paths, including cards previously deleted from the diagram. Unknown extension data is left
untouched. A concurrent content change or a rewritten text link can instead block the old
operation: pending work stays visible, but cannot overwrite the current source. Discard the
local draft only if you no longer need it, then make a fresh edit from the updated diagram.
A failed agent planner captured before a rename is not reapplied automatically. Moving the
canvas itself still blocks a draft begun at its old location; pictures and relative links
refresh against the new location.

Returning to **Open in Obsidian Canvas** with pending work asks you to stay, explicitly retain
it in memory while opening the saved source, or discard it. Retaining does not save the draft;
native changes (even a formatting-only save) can block retry. A failed Undo/Redo leaves a
local history preview: text editing is unavailable until that preview is discarded.
Explicitly discard it before trying Undo/Redo again, rather than saving it as a new text change. Failed agent proposals and uncertain writes still use the
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

Embed a canvas as usual, or name a one-based step, a card or frame, or a part of the canvas
(`x,y,width,height` in the canvas's own units):

```markdown
![[sample.canvas]]
![[sample.canvas#step=2]]
![[sample.canvas#node=alpha]]
![[sample.canvas#part=0,0,800,500]]
```

Reading view and Live Preview show a static picture with **Open** and **Play** buttons.
The step's explanation appears below its picture. Open goes to the named view; Play begins
at the named step (the first step when no step is named). Pictures follow changes to the
source. Scrolling the surrounding note is still the note's gesture, not canvas panning.
Without Abele, Obsidian can still open and embed the ordinary canvas, without the walkthrough.

The picture action in the viewer's header offers **Export whole canvas as PNG**, **SVG** or
**PDF**. These include the complete diagram even while you are zoomed into one card or viewing
only the first walkthrough step. Current-view and each-step PNG/SVG exports remain available.
Exports capture the current shared content once, including pending cards, without saving drafts
or changing the canvas. They use the current Obsidian theme and the same picture renderer as
canvas embeds and agent pictures: note text, shapes, connections, free/attached ink and local image attachments.
Interactive note widgets are painted as static content, not copied as running code.

Each export is a new file in the ordinary attachments folder; an existing file is never
replaced. Open the picture menu again during a long export to **Cancel whole-canvas export**;
closing or switching away from the canvas also cancels it before delivery. After success,
**Insert exported file into note…** opens Obsidian's note picker and appends a normal embed at
the end of the chosen note. The export is a snapshot, not a live link to later canvas changes.

PNG and SVG use at most 4096 pixels on the longer side. SVG contains PNG pixels, not editable
vector shapes. PDF is one page with a high-quality JPEG image, not selectable text. A very large
diagram may have small text: keep the canvas embed or export a closer current view for detail.
Missing or oversized images are omitted and reported in the completion message. Each image is
limited to 8 MiB, the combined encoded images to 16 MiB and the combined decoded images to
16 million pixels. Animated PNG/GIF/WebP, AVIF, and SVG containing other images or filters
are also reported as unavailable because their decoded memory cannot be safely bounded;
plain vector SVG drawings and static PNG/GIF/WebP work.
Remote images are never fetched.

The agent has the same whole-canvas export, with its own Ask permission and access only to
notes and images in the chat's scope. SVG drawings retain their existing pen tools and export.

## Where it is kept

The drawing is saved a moment after you stop, when drawing is turned off and when the tab
closes. The file holds the picture as any app shows it and, inside it, every line with the
points it went through, so the plugin opens it again for drawing. A change made on another
device appears in an open drawing as it arrives.
