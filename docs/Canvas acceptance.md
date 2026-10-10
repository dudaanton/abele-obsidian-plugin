# Canvas acceptance

The editor, drawing-aware embeds, whole-canvas image export and PDF export already share
one `.canvas` document and renderer. No replacement exporter, embed implementation or
additional agent tool is needed for the acceptance scenario below.

## Requirement evidence

Paths in the table are relative to `plugin/`. “Held” means implemented, with the listed
regression coverage; it is not a claim about every host version or physical device.

| Requirement | Status | Implementation and regression evidence |
| --- | --- | --- |
| Infinite canvas, pan, zoom and fit | Held | `src/canvas/Viewer.ts`; `tests/e2e/canvasViewer.e2e.test.ts` checks pan/zoom and walkthrough cameras. |
| Human nodes, linked notes, resizing, editing, deletion, groups and undo | Held | `src/canvas/Editor.ts`, `editorControls.ts`; `tests/e2e/canvasEditor.e2e.test.ts`, `tests/unit/canvasEditor.test.ts`. |
| Pen/marker drawings attached to nodes | Held | `src/canvas/core/ink.ts`, `inkAdapter.ts`, `inkEditAdapter.ts`; `tests/unit/canvasInk.test.ts`, `tests/e2e/canvasInk.e2e.test.ts`. Stored samples survive node moves/resizes; transformed outlines follow their owner. |
| Shapes, bound connections, arrows and free primitives | Held | `src/canvas/core/edit.ts`, `primitives.ts`; `tests/unit/canvasPrimitives.test.ts`, `tests/e2e/canvasConnections.e2e.test.ts`. |
| Whole-canvas PNG/image export including drawings | Held | `src/canvas/exportAdapter.ts`, `core/export.ts`, `core/painter.ts`; `tests/unit/canvasInk.test.ts` covers off-card and ink-only export bounds. `tests/e2e/canvasInk.e2e.test.ts` compares human and agent export bytes. `tests/e2e/canvasExport.e2e.test.ts` includes distant cards and note/image/SVG assets while only one walkthrough card is visible. |
| Whole-canvas PDF export | Held | The same snapshot and painter feed `imagePagePdf`; `tests/unit/canvasExport.test.ts` checks page count, stream lengths and byte offsets. `tests/e2e/canvasExport.e2e.test.ts` opens the one-page PDF in the reader. |
| Embed a canvas in another note; drawings render and saved changes refresh it | Held | `src/canvas/embed.ts` uses `canvasPicture`, observes vault modify/rename and CSS changes, and owns reading-view/Live Preview embeds. `tests/e2e/canvasAcceptance.e2e.test.ts` changes the canvas while embedded and compares the refreshed PNG with `look_at_canvas`. `tests/e2e/canvasInk.e2e.test.ts` compares drawing-aware embed/export bytes. |
| Rename a linked note | Held | Host Canvas reference rewriting; `src/canvas/core/references.ts` and the document registry reconcile standard-field rewrites with shared history. `tests/e2e/canvasAcceptance.e2e.test.ts` renames through the host UI and opens the renamed note from its card. `tests/e2e/canvasCompatibility.e2e.test.ts` also covers closed canvases and text links. |
| Rename an attachment or its folder | Held | `tests/e2e/canvasCompatibility.e2e.test.ts` checks image/drawing file nodes and group backgrounds through attachment/folder moves. `tests/integration/canvasReferences.test.ts` covers draft/undo reconciliation and refusal of stale in-flight writes. |
| Agent node, link, group, shape and drawing authoring/editing | Held | `canvas_create` and `canvas_edit` in `src/ai/tools/CanvasTools.ts` expose the shared semantic operations: node/edge/line updates, group/ungroup, move/scale, ink add/update/attach/detach/remove. Updating/removing ink samples can represent partial or whole erasure. `tests/integration/canvasTools.test.ts` covers mixed atomic batches, drawing data, defaults and revisions; `tests/integration/canvasInkDispatch.test.ts` covers actual chat/sub-agent permissions and shared undo. |
| Agent layout, step-by-step explanation and picture reading | Held | `canvas_layout`, `canvas_steps`, `canvas_read`, `look_at_canvas`; `tests/integration/canvasStepsTool.test.ts`, `tests/unit/canvasInk.test.ts`, `tests/e2e/canvasViewer.e2e.test.ts`. Steps reveal/highlight/focus ink and cards; picture reading supports whole-scene, node and region crops. |
| Agent export parity | Held | `canvas_export` calls the same exporter as the human menu; `tests/integration/canvasExportTool.test.ts` covers scope, creation permission and cancellation. The acceptance test compares human/agent PNG bytes. All seven tools are documented in `src/docs/tools.md`. |

## Combined live scenario

`tests/e2e/canvasAcceptance.e2e.test.ts` uses an owned synthetic folder and real input:

1. Choose New canvas, type its name, and insert a note through the file picker.
2. Draw on the note, move it, and check that stored pressure samples are unchanged while
   ink bounds translate by exactly the node's displacement.
3. Call the actual agent tools to add a shape, connection, attached marker stroke and steps.
4. Rename the note through the native rename UI and open it through the canvas action.
5. Embed the canvas in a note, change it with an agent edit, check its refreshed picture
   against `look_at_canvas`, and render it in both reading view and Live Preview.
6. Play just the first step, then export the whole PNG and PDF. Compare human/agent PNG
   bytes, check the PDF header, and verify that export did not modify source bytes.

The file declares desktop and phone targets. On desktop,
`CANVAS_ACCEPTANCE_MOBILE=1` additionally runs at 390×844 under Obsidian's mobile
emulation with CDP touch gestures. Screenshots use the existing `ABELE_E2E_SHOTS`
configuration. Emulation does not verify iOS/WebKit, a physical keyboard or device storage.

## Export boundaries

- PNG is raster; SVG embeds those PNG pixels, rather than editable vectors.
- PDF is a single JPEG-backed page, not selectable text or a paginated print layout.
- Whole export is independent of the current camera/walkthrough step. Local assets can
  produce missing, scope, size or clipping warnings; remote images are not fetched.
- Embeds follow persisted changes, not unpublished human drafts. An exported attachment
  inserted into a note is a snapshot; embedding the `.canvas` itself is the updating form.
- Native compatibility still has explicit `it.fails` coverage for unknown native node types
  and native node-array reordering. Abele uses standard node types and stable ids; these
  host limitations are not silently promoted into guarantees.
