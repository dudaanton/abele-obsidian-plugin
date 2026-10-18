# Drawing and pictures

Draw directly on a canvas with its pen, marker, eraser and lasso. Standalone SVG drawing
creation and editing have been removed.

## Existing standalone drawings

Your SVG files stay where they are. They still display as pictures, and existing note embeds
keep their saved part and size. Previously saved drawing tabs open read-only.

Run **Convert legacy drawings to canvases** in the command palette to create canvases beside
existing drawings throughout the vault. Originals and notes are never changed. Repeating the
command skips conversions already present, even if either file was subsequently edited.
Unrelated canvas filenames are kept; a numbered name is used instead. A completion notice
reports converted, existing and failed counts. Detailed results are in the developer console.

Pen and marker strokes become editable canvas ink with the same geometry and colours.
Drawings that also contain shapes, text or note cards keep an exact original SVG preview beside
the editable ink. Those objects remain read-only in that preview. Keep the original SVG: the
preview and existing note embeds refer to it. Unsupported metadata is reported without conversion.

## Drawing on pictures

The gallery viewer's **Crop** button opens the picture editor with its frame ready to drag.
Choose Free, Original, Square, 4:3 or 16:9; picking 4:3 or 16:9 again switches to portrait.
Drag the frame or its handles, turn left, mirror, or reset. Two fingers pan and zoom; one
finger draws or moves the frame. On a phone, the tools sit below the picture and Cancel and
Save stay above it. Cancel asks before discarding unsaved edits.

**Save** opens Obsidian's menu. Cropping, turning and mirroring apply to both the full resolution
picture and its ink; ink outside the frame is clipped. Sending to chat shows the output dimensions.
HEIC and HEIF pictures, where the device can decode them, are saved as JPEG copies; overwrite
is disabled. A save error stays visible and keeps the edits so saving can be tried again.

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
anything that could not carry over. The original drawing stays untouched; a name already in use
gets a numeric suffix. Links and embeds in referring notes and canvas file cards are updated to
the new canvas, with aliases, sizes and headings retained. Markdown images become native canvas
embeds so they still show a picture. The report counts rewritten references and lists any update
errors. Drawings already migrated are skipped.

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
