# Obsidian compliance

Abele is meant to be installable from Obsidian's community directory, which reviews a plugin
against [Obsidian's plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
and the [submission requirements](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin).
Obsidian publishes those rules as an ESLint plugin — [`eslint-plugin-obsidianmd`](https://github.com/obsidianmd/eslint-plugin) —
and that plugin is the authority here rather than a hand-kept checklist.

```bash
cd plugin && npm run lint
```

Every rule under `obsidianmd/` is raised to **error** and runs in CI, so a broken guideline
fails the build. The warnings that remain are general TypeScript hygiene from the bundled
`typescript-eslint` preset, not Obsidian requirements; `plugin/eslint.config.mjs` says which
ones are relaxed and why.

## Repository layout

The directory reads `manifest.json` from the **root of the default branch**, so it lives there
along with `README.md`, `LICENSE` and `versions.json`. The source stays in `plugin/`.

```
manifest.json      ← read by the community directory
versions.json      ← minAppVersion per released version
README.md          ← excerpt shown on the public listing
LICENSE
plugin/            ← source, build, tests
```

A release publishes exactly three assets — `main.js`, `manifest.json`, `styles.css` — under a
tag matching the manifest's `version`. `.github/workflows/release.yml` fails if the build emits
anything else, because a fourth file means a dynamic import split into a chunk no vault would
ever receive.

**Run the linter from the repository root, not from `plugin/`.** Several rules read
`manifest.json` from the working directory. The `lint` script changes directory for you.

## What the rules ask for, and where this plugin stands

| Guideline | Where it shows up here |
|---|---|
| No global `app` | Everything reaches the App through `GlobalStore.getInstance()`. |
| Popout-safe timers | `window.setTimeout` and friends throughout. |
| Obsidian element factories | `createEl` / `createDiv`; see the note on windows below. |
| No hardcoded styles | Fixed values live in `styles.css`; only measured geometry is inline. |
| Respect the trash preference | Deletion goes through `FileManager.trashFile()`. |
| Narrow with `instanceof` | `vault.getFileByPath()` and type guards instead of `as TFile`. |
| Cross-window type checks | `node.instanceOf(HTMLElement)` inside the editor. |
| `requestUrl` over `fetch` | Model lists and remote image downloads. |
| Obsidian's `AbstractInputSuggest` | The path pickers extend it; the Popper copy is gone. |
| Vault-scoped storage | Chat tabs use `App#saveLocalStorage`. |
| Sentence case | Commands, view titles and notices. |
| Quiet console by default | Diagnostics are `console.debug`, which Obsidian hides. |
| No lookbehind in regexes | Rewritten out of the Dataview migration; iOS lacks it before 16.4. |
| Node and Electron behind a platform check | One feature, guarded by `Platform.isDesktop`. |

Two of these are not caught by the linter and were found by reading: `regex-lookbehind` only
inspects `new RegExp('…')` strings, not regex literals, and `no-nodejs-modules` looks at import
statements, not a bare `require('electron')`. Both are worth re-checking by hand.

## Mobile

`manifest.json` declares `isDesktopOnly: false`, and the plugin holds to it. Exactly one
feature needs the desktop: "Show on disk" in the gallery viewer reveals a file in the OS file
manager, which Obsidian offers no cross-platform API for. It sits behind `Platform.isDesktop`
and falls back to copying the path, so on a phone the menu entry still does something useful
rather than throwing.

### Which window an element belongs to

Obsidian installs its element factories on every window it opens, but the bare globals are
bound to the **main** window's document:

- `createDiv()` — always builds in the main window, detached until appended.
- `someDoc.win.createDiv()` — builds in *that* document's window.

Anything that must appear in the window the user is looking at — a suggester popup under a
field in the settings window, a modal's mount point — uses the second form. Obsidian's own
types do not declare those methods on `Window`; `src/obsidian-window.d.ts` adds them, with the
runtime behaviour it was verified against.

## Reproducing the review

The community directory's automated review runs Obsidian's preset **as shipped**, not this
project's configuration. A clean `npm run lint` therefore proves nothing about the review, and
the first submission of 1.2.0 was rejected for four findings that were green locally.

```bash
cd plugin && npm run lint:review
```

`eslint.review.mjs` takes the preset whole with nothing relaxed. What matters in its output is
anything under `eslint-comments/` — the preset **forbids `eslint-disable` comments for its own
rules**, and the review reports each one as a **Risk**. That is what the four rejections were:
not the underlying rules, but the act of silencing them.

**So there are no `eslint-disable` comments for Obsidian's rules anywhere in `src/`.** Where an
exception is genuinely needed it lives in `eslint.config.mjs`, which is this project's to set,
with the reason recorded there. The review still sees and reports those two findings — as
ordinary findings rather than as suppressions.

## Three findings that stand

**Scripts are compiled with `new Function`** (`src/scripting/ScriptService.ts`). Running a
script the user wrote in their own vault requires compiling it; there is no variant of the
feature without dynamic evaluation. The code is handed only the capabilities in its context
object. Reported by `no-new-func` and `no-implied-eval`.

**The settings tab renders imperatively** (`src/settings.ts`). Obsidian 1.13 added
`getSettingDefinitions()`, which makes settings searchable — but the tab is then rendered
*declaratively from those definitions and `display()` is never called*. Abele's settings are a
Vue application with its own tabs, cards, agent editor and scope editor, so adopting the API
means replacing the entire settings UI, not annotating it. The cost of standing still is that
Abele's settings are found by opening the tab rather than by searching.

**A script's view carries its own `<style>` element** (`src/components/ScriptView.vue`). A
script can give the tab it opens some CSS of its own, and that CSS exists only once the script
has run — `styles.css`, which is written before any script is, cannot hold it. The element is
made in the tab's own document, so a view in a popout window is styled where it is drawn, and
every selector in it is prefixed with the tab's root (`scopeCss`), so nothing the script writes
reaches past its tab. Reported by `no-forbidden-elements`.

## Known gaps

Not enforced by Obsidian's linter, and worth doing.

**`activeDocument`.** 31 places reach for `document` where a popped-out window would need
`activeDocument`. Obsidian leaves `prefer-active-doc` switched off in its own preset, so this
is not currently required — but the same class of bug has bitten this plugin before.
