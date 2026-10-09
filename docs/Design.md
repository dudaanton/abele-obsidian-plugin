# Design standard

Abele composes Obsidian's visual language, not a look-alike. Use the host's components,
fonts, colours, radius, hover and focus states. The hierarchy is always:
**section → object → essential metadata → optional detail**. Native phone typography wins;
these mappings must never become a global override of Obsidian's mobile UI.

## Hierarchy and tokens

| Level | Size | Weight | Colour |
|---|---|---|---|
| Section | `--font-ui-medium` | `--font-semibold` | `--text-normal` |
| Object title | `--font-ui-small`, or inherited native row size | `--font-medium` | `--text-normal` |
| Essential metadata | `--font-ui-smaller` | `--font-normal` | `--text-muted` |
| Expanded detail | `--font-ui-small` | `--font-normal` | `--text-normal`; labels muted |

UI uses `--font-interface` and `--line-height-normal`. Readable quotations use `--font-text`.
Only code and technical identifiers use `--font-monospace`. Important timestamps, missing
files and recovery instructions are not `--text-faint`. Detail is subordinate because it is
placed behind disclosure, not because it is microscopic.

Keep native row padding. Additional composition spacing uses `--size-4-1` within related
facts, `--size-4-2` between row parts, `--size-4-3` around expanded detail and `--size-4-4`
between groups. `Section` retains its existing larger settings-section variant; that is not
permission to enlarge ordinary list rows. Radius comes from `--radius-s`, `--radius-m` or
native `--input-radius`, never an invented pill.

### Density and text

- Desktop: compact rows. Optional actions may appear on hover **and focus**; reserve their
  space so the title does not shift. Always-visible actions are also acceptable.
- Phone: one column, actions discoverable without hover. Prefer one frequent action plus an
  Obsidian `Menu` for extras. Increase hit areas, not decorative glyphs.
- Compact titles wrap to two lines. Opening or expansion must expose the full title. Form
  labels, warnings, errors and expanded detail wrap fully. Use `min-width: 0`; break long
  unbroken segments only when necessary.
- Metadata contains short complete facts, separated by ` · `; no separators around missing
  optional facts. Zero is a value. Required unknown facts are explicit. Wrap by fact and
  permit a second line on phone. A recovery or permission explanation never silently truncates.
- Use container width for reflow and host phone mode for touch/shell behaviour. Never adapt
  a modal by reading the ambient main window's width.

## Time and paths

All new display dates go through `src/helpers/displayFormat.ts` (`formatTimestamp`) and
`RelativeTime`. Keep `DD.MM.YYYY` and `HH:mm`; recent calendar days may say Today/Yesterday
(and Tomorrow for scheduled work). Calendar-day comparisons use the chosen timezone, not
elapsed 24-hour intervals. Supply `now` for deterministic tests; refresh it deliberately if
an open screen needs a live clock. No component-owned timers or storage-format changes.

`<time datetime>` carries the instant and an exact accessible label. Exact time is also
available in touch-accessible detail, not solely a hover tooltip. Diagnostic history includes
seconds, timezone and offset, distinguishing repeated times during daylight-saving changes.
Missing or invalid values say **Time unknown**, never Invalid Date.

A path title shows its basename with meaningful extension. Metadata shows the parent
location without repeating the basename. Duplicate filenames must show differing parent
locations. `PathLabel` exposes the full selectable path in detail (and optional copy/reveal
requests). Remote paths name their node/workspace and retain their original slash syntax.
Missing targets keep their identity, path and valid actions; disabled Open/Reveal explain why.

## Actions, colour and touch

Use at most **one `mod-cta` per dialog state**. Secondary actions remain neutral; destructive
actions use the existing confirmation before deletion. Annotation choice displays actual
swatches, with a selection ring/check and accessible names; a grey word-only dropdown is not
a colour picker. Status always includes text or a glyph, never colour alone.

Every action has an accessible name, visible focus ring and keyboard operation. `Icon` in
interactive mode is a real `button type="button"` using native `.clickable-icon`; Enter and
Space activate it through browser semantics. Decorative mode has no tab stop or button role.
Existing click-listener/toggle callers infer interactive mode; new code should name it explicitly.
Do not add parallel role/tab/key handlers to a semantic button. Disabled actions give a reason.
Main row actions and trailing controls are siblings, not nested interactive elements.

Phone controls measure at least **44 × 44 CSS pixels**. `obsidian/designKit.css` is the one
accessibility floor, `max(44px, var(--touch-size-m))`, not a private spacing scale. Verify actual
geometry in Obsidian; DOM-only component tests cannot measure it. Older screens join this
policy during migration, including controls with previously smaller hit areas.

| Glyph | Meaning / native example |
|---|---|
| Native collapse triangle | Fold children/detail, like Explorer and Backlinks |
| `chevron-right` | Navigate deeper, like a navigation choice |
| `pencil` | Edit, never choose colour |
| `plus` | Add/create |
| `search` | Search, like native pane search |
| `ellipsis` | More actions in Obsidian `Menu` |
| `link` / `unlink` | Attach/link or detach/unlink |
| `copy` | Copy; duplication needs explicit wording |
| `trash` | Delete, followed by confirmation |
| `folder` | Folder; Reveal in file explorer needs an action label |
| `message-square` | Open a message/comment |
| `refresh-cw` | Refresh/retry, with explicit wording |
| `x` | Close/dismiss/remove from selection, not file deletion |
| `image-off` | Image unavailable; keep its identity and explanation |

No text triangle disclosure glyphs. `Disclosure`/`FoldHeading` draw Obsidian's collapse icon;
native `details/summary` is an allowed semantic alternative. Expansion must not also open an
object. A full quotation expands in place and stays selectable, never styled as an input or
annotation highlight.

## Shared kit

Components live in `plugin/src/components/obsidian/`. New patterns belong here with behaviour,
state and accessibility tests before screens adopt them.

| Component | Native pattern and contract |
|---|---|
| `ListRow` | Search-result/backlinks flat object row: leading icon/thumbnail, title, metadata, snippet, sibling actions, detail slot. Controlled selection; retained identity during loading/missing/error. |
| `MetaLine` | Backlinks secondary line: stable keyed facts, optional labels, separators only between present facts; required unknowns explicit. |
| `RelativeTime` | Search metadata: semantic instant, controlled clock, exact detail and unified formatter. |
| `PathLabel` | Backlinks location: basename/context/full modes, workspace disambiguation, selectable full path, optional copy/reveal events. |
| `Disclosure` | Tree-item collapse control: controlled expanded state, optional count and associated detail. Whole label is the control. |
| `ListSectionHeader` | Backlinks section: count independent of folding, zero/loading/filtered counts, optional search/actions; owns layout. Legacy class prefixes remain compatibility hooks. |
| `EventList` | Grouped search results: ordered title, actor/source, time, optional source jump, expandable detail, pending/unavailable/retryable failure. Preserves caller chronology. |
| `SheetHeaderActions` | Native modal contextual action and overflow `Menu`; no duplicate title or close overlay. Filters occupy a separate row; menu dismissal returns focus to its trigger. |
| `Quote` | Backlinks excerpt/native blockquote: preview, selectable expanded text, source, unresolved-source notice and honest empty copy. |
| `SwatchPicker` | Native colour controls: named visual radio choices, roving keyboard focus, controlled ring/check selection, disabled/busy states; optional separate underline. Choices wrap instead of overflowing. |
| `Image` | Vault/URL picture; bounded `variant="thumbnail"` attachment slot with loading/missing/broken fallback and optional named preview action. Default contain; use cover only where cropping is safe. |
| `EmptyState` | Search/backlinks empty section: empty, no-matches, loading and error variants; optional relevant action. Refresh retains existing content rather than replacing it with emptiness. |
| `Icon` / `Button` | Native glyph action / labelled action. Tooltips use Obsidian `setTooltip`, not an invented popup. |
| `Setting` / `Section` | Native labelled form row / settings group. Never replace forms with flat object rows. |
| `Card` / `CardGrid` | Rich previews and explicit choices, not dense inventories. Card consumes `MetaLine` and optional `PathLabel`; subtitle is ordinary secondary prose. Covers/thumbnails and action slots remain. |
| `TreeItem` / `FoldHeading` | Real hierarchies / folding list heading. Native tree classes, count and controlled folding. Plain trees have no artificial focus. |
| `Badge` | Short status with host named colour and text. |
| `Input`, `Dropdown`, `Checkbox`, `Search`, `Slider` | Host form controls. Password inputs do not offer remembrance; `Input` emits commit after editing. Sliders track input separately from committed changes. |
| `Tabs`, `Breadcrumbs` | Native navigation; phone tabs may intentionally scroll with focused tab in view. Breadcrumbs expose folded trails. |
| `NotePicker`, `IconPicker` | Host-styled choices with keyboard operation and named options. |
| `Modal`, `ConfirmModal` | Shared shell / explicit destructive confirmation. |
| `Table` | Structured columns; intentional horizontal scrolling, not a substitute for a flat list. |
| `Avatar`, `QrCode`, `FloatingButton` | Decorative identity fallback / scanner contrast / native raised quick action. |

Noninteractive primitives do not acquire artificial focus/loading states. Stateful compositions
distinguish empty, loading, missing and failed, retain content on refresh and expose selection
programmatically. Specialized editors, tables, calendars, trees and forms remain documented
alternatives to `ListRow`.

## Dialog sizing and shell

Every plugin dialog uses `src/modal/ShellModal.ts` (or kit `Modal` slots), extending Obsidian
`Modal`. SuggestModal/FuzzySuggestModal stay native. The host's **`mod-lg` is the phone sheet**;
never build a separate overlay.

| Content | Mode |
|---|---|
| Short input/confirmation, including new text comment | Default content-sized |
| Short content specifically requiring a phone sheet | `phoneSheet` / `phone-sheet`, without tall |
| Sustained browsing, populated inventory, navigation, long history | `tall` / native `mod-lg` |
| Workspace code/diff needing all available room | `full` |
| Form requiring wider columns | `wide`, not automatically tall |

One shell title, no repeated purpose heading. Footer immediately follows short content; long
content scrolls above reachable footer actions. Do not strand Save/Close far below a field.
Internal actions stay beside their field. Do not resize the shell while someone types.

Preserve ShellModal keyboardRoom handling: measure the element's visual viewport, host keyboard
height and toolbar without double subtraction; keep focused fields/caret visible and the
footer reachable above keyboard/safe areas. Native large sheets retain native placement. Use
the element's `ownerDocument`/`defaultView`, including separate Settings windows. Teleport to
an element, not a selector in the wrong document. Imperative builders fill bodyEl/footerEl and
use shell addButton. Nothing is destroyed via `window.confirm`.

## Enforcement and review

`tests/unit/designConformance.test.ts` retains the existing legacy source gates and adds a
strict parsed inventory for this kit. Vue template/import trees resolve aliases, TypeScript
calls protect formatter use, and parsed compiled CSS rejects literal colours, typography,
spacing and invented tokens. Strict screens are explicitly incremental: Artifacts, comments,
navigation/history, agents, node screens, then remaining legacy surfaces. No screen migration
is implied by adding a primitive. Global shell/editor CSS and imperative builders predate the
strict gate; new declarations/builders join it as those surfaces migrate.

Narrow exceptions: 1px hairline borders, responsive breakpoint conditions, QR scanner contrast,
and actual data-driven editor/diagram geometry. The centralized 44px accessibility floor is
also named. A generic tokens file is not permission to invent colours. No static inline style;
data-driven geometry must have its own documented test. Class naming is
`abele-<block>__<element>_<modifier>`.

Unit/component tests protect behaviour and accessibility, not appearance. Live phone/focus-ring
tests inventory intended actions, target sizes, overflow, scroll reachability and focus return.
Content-sized dialogs are checked separately from tall sheets. The test-only design catalogue
renders synthetic states and real composition recipes inside Obsidian, and the production
bundle guard must exclude its entire graph. It is not a production feature.

Before landing: capture desktop and phone empty/one/many/long/missing/error/loading/selected/
expanded states as applicable. Open every PNG beside native Explorer/Search/Backlinks/Menu
references. Review native fidelity, hierarchy, density/spacing, state completeness and
keyboard/touch. Colour shows colour, no repeated heading, one primary action, actions close to
fields. Geometry passing is necessary, not visual approval. Shared patterns require manager
review before adoption; screen arrangements require owner selection. Real-device keyboard/touch
verification remains additional to emulation. Capture and deployment tooling stays local.
