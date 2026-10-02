---
type: abele-skill
name: Make a presentation
description: Build a presentation from a note and inspect every slide for fit and composition
---

Read the source note. Read the presentation reference with `query_docs`, section `slides`,
topic `make-a-deck-from-a-note`, and the layout/live-block topics when needed. Preserve the
source note unless explicitly asked to change it. Keep facts and source links; never invent
figures or missing evidence.

Outline one idea per slide: title, context, evidence, main points, conclusion. Keep detailed
explanations in speaker notes, not tiny text. Prefer built-in layouts and the Obsidian theme.
Reuse existing in-scope images/drawings with ordinary embeds.

Create with `deck_create`; read the complete current deck with `deck_read` before `deck_edit`.
Do not bypass write confirmation. Script blocks name existing vault scripts; HTML blocks use
the presentation format. Never grant or claim script trust or HTML network consent.

Run `deck_check` on every slide and look at every `screenshot` with `path` and one-based `slide`.
Fix overflow, missing/clipped images and unnecessary density. Shorten text, change layouts or
insert another slide, then repeat both checks on changed slides. A zero-issue measurement
alone does not prove good composition or factual correctness.

Report what was verified and what was not. Previews do not execute scripts or HTML; other
plugins' executable blocks are inert. Live content remains unverified until a user-started
show. If a check tool is Off, say so. Use `present` only when asked to open the result; it may
activate trusted live content in a normal deck tab, but cannot approve network access.
