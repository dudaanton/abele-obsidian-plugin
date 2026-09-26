# Drawing

A canvas with no edges to draw on with a pen, a finger or the mouse. A drawing is an ordinary
SVG picture in your vault, so a note shows it with or without the plugin, on any device.

## A new drawing

**New drawing** in the command palette makes one where new notes go, and a folder's menu in the
file explorer makes one in that folder. It opens ready to draw on. Clicking a drawing anywhere —
the file explorer, a link, the quick switcher — opens it in its own tab again; every other SVG
opens in Obsidian's picture view as before.

## Drawing

The first button of the bar over the drawing turns drawing on; in the same place, the tick turns
it off. While drawing is on, the drawing takes every touch: Obsidian's swipes, menus and long
presses do not answer there.

- **Pen** — the harder a pen presses, the wider the line.
- **Marker** — a wide see-through line, like a highlighter.
- **Eraser** — takes away every whole line it touches. The eraser end of a pen erases too.
- The dots pick the colour, the wavy line how thick the pen and the marker draw.
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
beside the note to draw on. It goes into the note as a callout with the picture in it:

```markdown
> [!drawing|120 40 800 500]
> ![[Sketch.svg]]
```

The numbers after the bar are the part of the drawing the note shows; without them it shows all
of it. Two buttons sit in the corner of the picture. The pen opens the drawing at that part to
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
Pick a part first to ask about only that part. Nothing is sent until you send it. The agent can
also look at a drawing whenever you ask it to in a chat, all of it or a part, and closer when
the writing is small.

## Drawing on pictures

**Draw on this picture** in a picture's menu in the file explorer — PNG, JPEG, WebP, GIF or BMP —
opens it in a tab with the same tools, the picture under the ink. In the chat, right-click a
picture the agent made or showed, or one you attached, and choose **Draw on it**.

The picture stays as it is until you choose, in the menu at the end of the bar, what becomes of
it: **Save over the picture** (asked about first), **Save as a new picture** beside it, or **Send
back to the chat**, which saves a new picture and attaches it to what you are writing there. A
picture that cannot be written in its own kind — GIF, BMP — is saved as a new PNG. Closing the tab
without saving keeps nothing.

## Where it is kept

The drawing is saved a moment after you stop, when drawing is turned off and when the tab
closes. The file holds the picture as any app shows it and, inside it, every line with the
points it went through, so the plugin opens it again for drawing. A change made on another
device appears in an open drawing as it arrives.
