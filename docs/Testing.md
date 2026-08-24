# Testing

Three tiers, each with its own command. All commands run from `plugin/`.

| Command | Tier | Needs Obsidian | Runs on commit | Runs in CI |
|---|---|---|---|---|
| `npm test` | unit + integration + component | no | yes | yes |
| `npm run test:perf` | complexity | no | no | no |
| `npm run test:e2e` | end-to-end | yes | no | no |
| `npm run test:all` | everything | yes | no | no |

`npm run test:watch` re-runs the fast tier on change.

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
  `vault.getAbstractFileByPath`, `metadataCache.getFileCache`,
  `metadataCache.getFirstLinkpathDest` and `metadataCache.resolvedLinks`. Link resolution
  follows Obsidian's precedence: exact path, then path + `.md`, then an unambiguous basename.

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

## Generating a test vault

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
