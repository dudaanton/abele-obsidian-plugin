# Design

The plugin renders inside Obsidian, so it inherits Obsidian's visual language rather than
inventing one. This document is the standard: what the shared vocabulary is, the rules that
keep screens consistent with it, and the tests that hold the line.

## The kit

Every visual element lives in `src/components/obsidian/`. A screen composes these; it does
not invent its own.

| Component | Use it for |
|---|---|
| `Setting` | One labelled row: name, description, control. The backbone of every settings screen. |
| `Section` | A heading with an optional description, wrapping a group of rows. |
| `Tabs` | Any tab strip — top-level settings navigation, a sub-navigation, a chart switcher. |
| `Card` / `CardGrid` | A repeated item you can click into: a model, an agent, a stored secret. |
| `Badge` | A short status word attached to a card or a title. |
| `EmptyState` | What a list says when it has nothing in it. |
| `Button` | Anything the user presses that carries a word. |
| `Icon` | Anything the user presses that carries only a glyph. Has `disabled` and `tooltip`. |
| `Input`, `Dropdown`, `Checkbox`, `Search`, `ColorPicker` | Form controls. |
| `Modal` | A dialog. `size="wide"` when a form needs more than the default column. |

If a screen needs something the kit does not have, the change belongs in the kit — with a
test — not in the screen.

## Rules

**Never style a bare `<button>`.** Obsidian ships `button:not(.clickable-icon)`, whose
specificity (0,1,1) beats any single class of ours (0,1,0). A hand-styled button therefore
renders as a default grey button no matter what the component's stylesheet says. Use
`Button`, use `Icon`, or use a non-button element with `role="button"` — the kit's `Tabs`
does the last of these.

**Colour, spacing, radius and type come from Obsidian's variables.** `var(--size-4-2)`, not
`8px`; `var(--text-muted)`, not `#888`. Literal lengths and hex colours are a bug: they stop
tracking the user's theme and their zoom level.

**No `style="…"` attributes.** A one-off margin in the template is a pattern nobody can find
later. Give it a class, or give the kit a prop.

**Nothing scrolls horizontally.** Content wraps. `overflow-x: auto` belongs only on an
element that is deliberately a scroller — a code block, a wide table — and it is stated as
such in a comment. Tab strips wrap onto a second row rather than hiding tabs off the edge.

**Measure the element, not the window.** Since Obsidian 1.13 settings can open in their own
window, and a component rendered there sees the *main* window as `window` — so
`window.innerWidth` reports the wrong screen. Use `ResizeObserver` on the element, which is
also the honest question: a modal can be narrow inside a wide window.

**Class names are `abele-<block>__<element>_<modifier>`.** One block per component, named
after the component.

## Enforcement

`tests/unit/designConformance.test.ts` reads the component sources and fails on a bare
`<button>`, an inline `style` attribute, a literal colour or length, and an unexplained
`overflow-x`. It covers the settings screens, the shared kit and the chat components this
plugin's agent work introduced.

`tests/e2e/settingsLayout.e2e.test.ts` drives the running app and asserts that no settings
tab, and no modal opened from one, puts anything past its container's right edge — at a
desktop width, a narrow window and a phone width. See `Testing.md` for how that measurement
is taken and why `scrollWidth` cannot be used for it.

## Known debt

The chat surfaces that predate this standard still carry hand-rolled elements:
`AiChat.vue`, `AiChatMessage.vue`, `NotesList.vue`, `ScriptFormModal.vue` and
`TemplateVariablesModal.vue`. They are outside the conformance test's list. Migrate each onto
the kit when you next work on it, and add it to the list at that point.
