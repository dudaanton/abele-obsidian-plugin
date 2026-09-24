# Testing

Three tiers, each with its own command. All commands run from `plugin/`.

| Command | Tier | Needs Obsidian | Runs on commit | Runs in CI |
|---|---|---|---|---|
| `npm test` | unit + integration + component | no | yes | yes |
| `npm run test:perf` | complexity | no | no | no |
| `npm run test:e2e` | end-to-end | yes | no | no |
| `npm run test:all` | everything | yes | no | no |

`npm run test:watch` re-runs the fast tier on change.

**Do not touch Obsidian while the e2e tier runs.** There is one app and one CLI; a stray
`obsidian eval` — opening settings, resizing a window — races the probe the tests are waiting
on, and the run hangs rather than failing. A suite that sat for 25 minutes with no output was
this, not a slow test.

Two more checks run in CI beside the fast tier: `npm run types` and `npm run lint`. The linter
carries Obsidian's own plugin rules and fails on any of them — see
[Obsidian compliance](Obsidian%20compliance.md). It runs from the repository root, because
several of those rules read `manifest.json` from the working directory and the manifest lives
in the root; the `lint` script changes directory for you.

## Policy

New functionality is always covered by tests in the same change. Existing code gets covered
as it is touched. Prefer the fast tier — reach for e2e only when the behaviour genuinely
depends on Obsidian's runtime.

## Unit tier — `tests/unit/`

Pure functions, no Obsidian, no I/O. `tests/unit/pathsHelpers.test.ts` is the model to
follow.

`tests/unit/designConformance.test.ts` is the odd one out: it reads the component sources and
enforces the rules in `Design.md` — no hand-styled `<button>`, no literal colours or pixel
sizes, no inline `style` attributes, no unexplained `overflow-x`. Each rule is there because
breaking it produced a visible defect at least once. When adding a rule, prove it fails:
introduce the violation, watch the test go red, then take it out again.

## Integration tier — `tests/integration/`

Real plugin classes against an in-memory vault. Two pieces make this work:

- `tests/mocks/obsidian.ts` — stands in for the `obsidian` module. Vitest aliases the import,
  so `instanceof TFile` in production code matches fixtures. Only the surface actually used
  is implemented, so reaching for an unmodelled API fails loudly instead of passing against
  a stub.
- `tests/helpers/fakeVault.ts` — builds an `app` with `vault.getFiles`,
  `vault.getAbstractFileByPath`, `vault.create`, `vault.modify`, `vault.append`,
  `vault.process`, `metadataCache.getFileCache`, `metadataCache.getFirstLinkpathDest` and
  `metadataCache.resolvedLinks`. Link resolution follows Obsidian's precedence: exact path,
  then path + `.md`, then an unambiguous basename.

Every lookup increments a counter in `app.stats`, which lets a test assert on how much work
an algorithm does rather than how long it took. Operation counts are identical on every
machine; milliseconds are not.

Classes reach the vault through `GlobalStore.getInstance().app`. Tests assign the backing
field directly rather than calling `init()`, which would also start a `VaultWatcher`:

```ts
;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = buildFakeVault(specs)
```

## Component tier — `tests/component/`

Vue components mounted with `@vue/test-utils` against happy-dom. Use it to assert what
reaches the DOM — how many items a list renders, in what order, which elements exist.

happy-dom computes no layout, so this tier can never assert how something *looks*:
`getBoundingClientRect` returns zeros and nothing ever scrolls. Appearance and geometry
belong to the e2e tier, which drives a real Obsidian.

Because nothing scrolls, `IntersectionObserver` never fires on its own — and `@vueuse/core`
silently degrades to a no-op when the constructor is missing, which would make a paging
test pass without paging. `tests/helpers/fakeIntersectionObserver.ts` installs a stub whose
callbacks a test invokes directly; `scrollIntoView(element)` returns how many observers it
notified, so a test fails loudly when its target was never observed.

Mount with `shallow: true` and assert on classes: stubbed children keep the classes the
parent puts on them, which keeps the test about the parent's own behaviour.

Note that `@vueuse/core` registers observers in a post-flush watcher, so a test must await
one tick after `mount` before the sentinel is being observed.

`shallow: true` also stubs away every child's *slots*. A component whose content lives inside
`Modal` or `Setting` renders nothing until those are replaced by stubs that render their slot:

```ts
global: {
  stubs: {
    ObsidianModal: { template: '<div><slot /></div>' },
    Setting: { props: ['name', 'desc'], template: '<div><slot /></div>' },
  },
}
```

happy-dom has no `ResizeObserver`. A component that adapts to its own width needs a stub whose
callback the test fires with a chosen width — which is also how the narrow layout is driven,
rather than by faking a window size.

## Complexity tier — `tests/**/*.perf.test.ts`

States the cost an algorithm *should* have. Kept out of `npm test` because it currently
fails by design: `ScopeResolver.resolveGroup` rescans the whole vault once per node in a
group's transitive closure. Fold it back into `vitest.config.ts` once that is fixed.

## What the e2e tier covers

Three files, three concerns:

- `groups.e2e.test.ts` — **correctness**. Membership is pinned by a committed snapshot
  (`tests/e2e/__snapshots__/group-membership.json`), cross-checked against an independent
  reference built from Obsidian's link index, compared against the scope editor's preview,
  and exercised live by creating a note into a group and deleting it again. Regenerate the
  snapshot deliberately with `UPDATE_GROUP_SNAPSHOT=1`.
- `noteRelations.e2e.test.ts` — **what a note gathers**. Snapshots the tasks, logs,
  transactions and time entries a group note collects from its whole subtree
  (`tests/e2e/__snapshots__/note-relations.json`, regenerate with
  `UPDATE_RELATIONS_SNAPSHOT=1`), and measures the cost of building that set.
- `scopeResolver.e2e.test.ts` — **cost**. Measures one resolution and asserts on both the
  operation counts and the wall clock.
- `responsiveness.e2e.test.ts` — **UI stalls**. Samples a 16ms timer across a resolution and
  reports the longest stretch the main thread went unserviced. That stall is what the user
  experiences as input lag.
- `footerRender.e2e.test.ts` — **render cost**. Opens a wide group note and reports how much
  DOM its footer produced and how long the main thread was blocked. The component tier
  proves each list renders a single page; only this tier can show that the page is cheap.
- `commentChats.e2e.test.ts` — **comment chats end to end**. Runs the comment command on a
  selection in a scratch note and checks what the app shows: no raw `%%c:…%%` in the editor, an
  icon carrying the comment id, the chat file under the comment folder, nothing drawn in the
  margin and no dialog over the note. Then presses the icon: the comment opens as a tab in the
  AI sidebar with the way back to the passage, the way up into a full chat and the note button,
  and a second marker pressed replaces that tab rather than adding one. The same press is made
  again under `app.emulateMobile(true)` in a phone-sized window, where the sidebar is the whole
  screen. Cleans the note, the file and the window size up after itself.
- `dialogRings.e2e.test.ts` — **focus rings in the chat dialogs, on the desktop**. Focuses every
  focusable thing in every tab of the setup dialog and in the history, and measures its ring
  against every ancestor that clips: a box standing flush with the content cuts the ring a field
  draws outside its box, which happened twice in one day.
- `phoneLayout.e2e.test.ts` — **every chat dialog, on a phone**. Switches the app to
  `emulateMobile`, sizes the window to an iPhone (390×844), opens the chat, the settings dialog
  tab by tab and the history, and asks each screen the questions a phone-width layout fails:
  nothing past the right edge, a tab strip on one row and not shrunk below its tabs, at most one
  scroller inside the body and none capped at a desktop `max-height`, a sheet the height of the
  screen. Seeds a dozen skills and prompts so the lists have something to fill with, and removes
  them. Writes a PNG of every screen to `/tmp/abele-phone/` — **look at them before a release**;
  the 1.18.0 dialog passed every measurement anyone had thought to make and was still wrong to
  the eye. Restores desktop mode and the window size after itself.
- `drawerPanels.e2e.test.ts` — **every sidebar opened into a closed phone drawer**. Opens each
  panel into the folded right drawer under `emulateMobile`, slides the drawer open and checks the
  pane holds something. A panel teleported by selector mounted nowhere there. Pictures go to
  `/tmp/abele-drawer/`.
- `tabletLayout.e2e.test.ts` — **the settings and the sidebars, on a tablet**. A tablet is
  mobile but not a phone: under `emulateMobile` Obsidian decides which by a 600×600 media query,
  so a 1180×820 window gets its tablet layout for real. Checks that the plugin's settings keep
  their tab strip beside the page there (a phone's list of pages has no way back on a tablet),
  that the half-width sidebar setting opens the drawer across half the screen, and that a
  phone-sized window still gets the list. Pictures go to `/tmp/abele-tablet/`. A window behind
  others keeps its old viewport until it is reloaded, so every resize here is followed by one.
- `taskDatePhone.e2e.test.ts` — **the task's date dialog on a phone, keyboard up**. No emulator
  shows a keyboard, so the two ways a platform makes room for one are mimicked in a 390×844
  phone window: the dialog's container made shorter by hand (the page shrinks, the dialog's
  `vh` cap does not), and `window.visualViewport` replaced by one reporting the smaller height.
  In both the dialog has to fit the room, scroll inside, and show the time field. Writes one
  task note for the run and removes it; pictures go to `/tmp/abele-phone/task-date-*.png`.

- `githubLinks.e2e.test.ts`, `githubTabs.e2e.test.ts`, `githubSearch.e2e.test.ts`,
  `githubPhone.e2e.test.ts` — **the GitHub tabs, against a fake GitHub**. Each file starts a GitHub
  Enterprise Server of its own on `127.0.0.1` (`helpers/fakeGithubServer.ts`, run as a separate
  process: the test worker blocks on every `obsidian eval`, and a server inside it would leave the
  app's requests waiting on the call that waits for them). It serves `acme/widgets` from
  `helpers/fakeGithubRepo.ts` — two commits, a pull request between them whose patches are real
  diffs of the files it serves, an issue, a discussion over GraphQL, file contents, the tree and a
  tarball for code search — so every answer agrees with every other. The integration is switched
  on in memory with **Server** pointed at it, the token is a wrapped `getSecret` rather than a
  keychain entry (the keychain cannot delete one), the sidebars are folded so clicks land in the
  note, and `helpers/githubLive.ts` puts all of it back. Links in notes are clicked for real,
  through CDP's `Input.dispatchMouseEvent`, because what is under test is whether the plugin's
  listener or Obsidian's own handler gets the click: Reading view, Live Preview, the tab a plain
  click reuses, Mod-click's new tab, the back arrow, and links in a note's properties (the
  Properties view beside the note, and the properties in Reading view, with Alt going to a stubbed
  `window.open`). In the tabs: scrolling to a line of a diff, lines of a file and a late comment;
  selected lines copied (the clipboard is restored), inserted as a link and as a card the note then
  draws; a markdown file's Preview and Code and `?plain=1`; "Open file" from a pull request; find
  in the tab; whole-repository code search; go to definition; and the pull request on a phone,
  with pictures in `/tmp/abele-phone/github-pull-*.png`. Notes the files write are deleted.

- `bookReader.e2e.test.ts`, `bookPhone.e2e.test.ts` — **books, and nothing in them running**.
  Writes three books to the vault for the run: one crafted in
  `tests/fixtures/books/maliciousBook.ts` to run code in every way known — inline and external
  scripts, handlers, frames, objects, `meta` refresh, XSLT, SVG and MathML links, SVG animations,
  a spoofed policy, an SVG chapter, an XML chapter — each recording itself on the app's window if
  it runs; the author's own test book (`epub-test.epub`, CC0) with its Node calls; and a plain
  one. Visits every chapter, clicks every vector, then puts scripts into a page already showing
  to prove the page's policy stops them without the cleaning, and asks whether anything
  recorded itself, anything was opened or `child_process` was asked for. Runs twice: with the
  desktop's sandbox, and with the iPhone's, which allows scripts — so the second run is the
  cleaning and the policy alone. The phone file opens books under `emulateMobile` at 390×844,
  checks the page keeps clear of the floating header and bar, and turns a page by a tap; pictures
  in `/tmp/abele-phone/book-*.png`. WebKit itself cannot be run here.

Correctness runs on small groups so it stays quick; cost and responsiveness run on the wide
"mega group", where a single resolution currently takes about two minutes.

## End-to-end tier — `tests/e2e/`

Drives the running Obsidian through its CLI — no Playwright or Electron harness. See
`tests/e2e/helpers/obsidianCli.ts`.

Setup:

```bash
npm run build:test                        # development build, includes the test hook
cp build/main.js  <vault>/.obsidian/plugins/abele/main.js
cp build/main.css <vault>/.obsidian/plugins/abele/styles.css
obsidian vault=<vault> plugin:reload id=abele

OBSIDIAN_TEST_VAULT=<vault> npm run test:e2e
```

Environment variables: `OBSIDIAN_TEST_VAULT` pins which window to drive (Obsidian can have
several open, and the CLI otherwise targets whichever is frontmost); `OBSIDIAN_TEST_GROUP`
selects the group note to measure; `OBSIDIAN_CLI` overrides the CLI path.

`vault=<name>` must be passed **before** the command — `obsidian vault=X eval code=…`, not
`obsidian eval code=… vault=X`. Passed after the command the CLI ignores it without an
error and runs against whichever window is frontmost, so the tests would silently measure
the wrong vault. `obsidianCli.ts` prepends it for this reason.

Live windows can be listed with `obsidian dev:cdp method=Target.getTargets` — page targets
carry the vault name in their title. A vault marked `"open": true` in `obsidian.json` whose
window is actually gone cannot be reopened with `obsidian://open?vault=…`; the URL focuses a
window that no longer exists.

The suite skips itself when Obsidian is not running or the build lacks the test hook, so
`npm run test:all` stays usable with Obsidian closed.

### Asserting that a layout does not break

happy-dom cannot answer this, and a screenshot only answers it for whoever looks at it. In a
running Obsidian the question is geometric and can be asserted: take the container's
`getBoundingClientRect()`, walk its descendants, and fail on any whose right edge is beyond it.

`tests/e2e/settingsLayout.e2e.test.ts` does exactly that for every settings tab and every
section of the agent editor. Read it before writing another of these — it also shows how to
run an asynchronous probe, which matters (see below).

Two things must be filtered out or the check reports phantoms. Obsidian sizes a dropdown by
cloning it off-screen — skip `.is-measuring`. And skip anything `visibility: hidden`,
`display: none` or absolutely positioned, none of which push a layout sideways.

Do not use `scrollWidth > clientWidth` for this: on a wrapped flex row it reports overflow that
is not there. It is still worth asserting `scrollWidth === clientWidth` on the *scroll
container* itself, which is the thing a person sees a scrollbar on.

Assert that the probe reached every screen it was meant to. A probe that silently failed to
open a modal finds nothing wrong, which reads exactly like a pass.

**`evalJson` cannot await a promise.** It wraps the expression in `JSON.stringify`, so an
async probe stringifies to `{}` — and an empty report passes every assertion about it. Park
the result on `window` and poll for it, as the responsiveness probe does.

#### Choosing a width

Resize the **settings window**, not the main one, and do not chase phone widths there:

```js
const w = require('electron').remote.BrowserWindow
  .getAllWindows().find((x) => x.getTitle().startsWith('Settings'))
w.setSize(620, 800)
```

Obsidian's own settings chrome stops adapting below roughly 600px in a desktop window: its
sidebar keeps its width and hands the plugin under 100px, which no layout survives and which
no user ever sees — a real phone runs the `.is-mobile` layout instead. What matters is the
width of the pane the plugin is actually given. At a 620px window that pane is about 356px,
which is a phone column, and it is a width a person can genuinely produce.

The main window is a different matter and does take CDP:

```
obsidian dev:cdp method=Emulation.setDeviceMetricsOverride \
  params='{"width":360,"height":740,"deviceScaleFactor":2,"mobile":true}'
```

That separate settings window is also why a component must measure **its own element** rather
than `window.innerWidth`: in a component rendered into the settings window, `window` is the
main one, and it will report the wrong screen entirely.

#### Screenshots

For looking rather than asserting, capture the settings window through Electron:

```js
const img = await w.webContents.capturePage()
require('fs').writeFileSync('/tmp/settings.png', img.toPNG())
```

Screenshots are for the person doing the work. They are never committed.

### What the harness does around every file

`tests/e2e/helpers/liveWindow.ts` runs before and after each file, and
`tests/e2e/helpers/globalSetup.ts` once at the end of the run:

- **Background throttling is switched off** for the driven window, and back on when the run is
  over. The window sits behind whatever else is open, and Chromium throttles a background
  window: timers slowed from 100 ms to seconds, frames stopped, and a probe waiting on either
  timed out or read a stale layout.
- **Stray settings windows are closed** — the popouts titled after the driven vault only. A
  probe that failed half way left one behind, and the next probe measured it.
- **The link index is waited for.** `emulateMobile` reloads the app, and after a reload
  Obsidian fills `resolvedLinks` in over several seconds; a file running straight after one
  saw a group of 442 notes as 6.

The CLI calls themselves are killed with `SIGKILL` at their timeout — a CLI call that never
gets its answer ignores `SIGTERM` — and a call answered with `Error: Command "…" not found`
(the app is there but still loading) is retried rather than parsed as a result.

### Known rough edge

The CLI helpers call `execFileSync`, which blocks the worker's event loop for the whole
duration of an `eval`. When two multi-minute files run in the same invocation, Vitest can
report `Timeout calling "onTaskUpdate"` alongside otherwise correct results. Running the
long files one at a time avoids it. The real fix is to move the helpers to async `execFile`.

### The test hook

Plugin singletons live in module scope inside the bundle and are unreachable from
`obsidian eval` — `app.plugins.plugins.abele` only carries Obsidian's own fields. So
development builds hang a small surface off `window.__abeleTest`
(`src/testing/exposeTestApi.ts`): `ScopeResolver`, `AgentService`, `GlobalStore`, `plugin`,
and `measureGroupResolve(path)`.

The call site is guarded by `process.env.NODE_ENV !== 'production'`, which Vite replaces
with a literal at build time, so the branch folds to `if (false)` and the module is
tree-shaken out. Verify with `grep -c __abeleTest build/main.js` after `npm run build` — it
must be `0`.

Keep the import of `exposeTestApi` **static**. A dynamic `import()` makes Rollup emit a
separate chunk, which turns `build/main.js` into a stub that cannot resolve its own bundle —
and the install scripts copy only `main.js`.

The same trap caught `script.unzip()`, whose `await import('fflate')` shipped as a chunk that
no release ever published. `build.rollupOptions.output.inlineDynamicImports` now forces a
single file, and the release workflow fails if `build/` holds anything but `main.js` and
`main.css`.

## Generating a test vault

**Four of the six e2e files need this vault.** `footerRender`, `groups`, `noteRelations` and
`scopeResolver` all address notes under `ScaleTest/`, and without them they fail with
`Group note ScaleTest/Notes/Projects.md not found in vault "<name>"`, an empty membership
snapshot, or a render probe that never finishes — nine failures that look alarming and mean
only that the fixture is absent. `settingsLayout` and `responsiveness` run without it.

`scripts/generate-vault.mjs` writes a realistic vault: the `groups` relation graph,
journals, tasks, finance accounts/transactions/categories, time entries and `.abchat` files.
Output is deterministic for a given `--seed`.

```bash
node scripts/generate-vault.mjs --out ~/obsidian-scale-test --files 12000 --seed 42
```

Options: `--out` (required), `--files` (approximate total, default 12000), `--seed`
(default 42), `--force` (write into a non-empty directory).

The group graph includes one deliberately wide "mega group" whose transitive closure covers
a large share of the vault. Group resolution costs (closure size) × (notes carrying a
`groups` property), so a wide closure over a link-dense vault is what makes that cost
visible. Measured on a 37,765-file vault, resolving one such group took **108 seconds**,
during which the main thread was blocked.

Link density matters as much as file count. Journals, tasks and transactions all link into
the general note population — which is itself group-attached — because backlink lookups and
relation walks scale with how many notes point at a group's members. A sparsely linked
vault hides that cost completely: an earlier version of this generator averaged 0 body links
per finance note and 1 per task, and `NoteRelations` looked fast. At realistic density
(~2 links per finance note, ~3 per task, ~9 per journal, ~6 per note) the same code took
seconds on a single group note — a quadratic backlink lookup that only a densely linked
vault made visible at all.
