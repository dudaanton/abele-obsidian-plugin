# Testing

Three tiers, each with its own command. All commands run from `plugin/`.

| Command | Tier | Needs Obsidian | Runs on commit | Runs in CI |
|---|---|---|---|---|
| `npm test` | unit + integration | no | yes | yes |
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
obsidian plugin:reload id=abele vault=<vault>

OBSIDIAN_TEST_VAULT=<vault> npm run test:e2e
```

Environment variables: `OBSIDIAN_TEST_VAULT` pins which window to drive (Obsidian can have
several open, and the CLI otherwise targets whichever is frontmost); `OBSIDIAN_TEST_GROUP`
selects the group note to measure; `OBSIDIAN_CLI` overrides the CLI path.

The suite skips itself when Obsidian is not running or the build lacks the test hook, so
`npm run test:all` stays usable with Obsidian closed.

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
(~2 links per finance note, ~3 per task, ~9 per journal, ~6 per note) the same code takes
seconds on a single group note.
