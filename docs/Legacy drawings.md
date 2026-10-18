# Legacy drawings

Use canvas ink for drawing. The standalone SVG drawing editor and its creation commands have
been removed. Picture editing, chat picture editing and crop, reader ink and Excalidraw
migration remain available.

**Convert legacy drawings to canvases** creates a canvas beside each standalone drawing in
the vault without changing the SVG or any note. Pen and marker strokes become editable canvas
ink, preserving geometry, pressure, colours and stroke profiles. Mixed drawings also include
an exact read-only preview of the original SVG beside the ink; shapes, typed text and note
cards remain in that preview rather than becoming editable canvas objects.

Existing SVG embeds, including saved parts and older drawing callouts, continue rendering.
Saved standalone drawing tabs become read-only; opening an SVG normally uses the host image
view. Keep the original SVGs, which existing embeds and mixed-content previews still use.

Conversions record the source path in `abele.drawingSource`. Repeating the command skips
sources with an existing conversion, even after edits to either file. Unrelated canvas names
are never overwritten. New conversions also record a source-content hash in
`abele.drawingSourceHash`, allowing a byte-preserving rename or move to find the earlier
conversion when the old source path is gone. Identical originals that still coexist remain
separate drawings. Older conversions without a hash retain path-based matching.
If the converted canvas is deleted, a subsequent run may create it
again. Malformed or unsupported metadata is reported without changing the source. The final
notice gives counts; detailed per-file results appear in the developer console.
Invalid raw sizes, colours, pressure or freehand profiles are rejected before the display
reader can substitute defaults, leaving those drawings unconverted and unchanged.
