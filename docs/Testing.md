# Testing

Three execution tiers: fast checks, bundle size, and live end-to-end. All commands run from
`plugin/`. Complexity checks and harness tests belong to the fast tier.

| Command | Tier | Needs Obsidian | Runs on commit | Runs in CI |
|---|---|---|---|---|
| `npm test` | unit + integration + component + harness (including complexity) | no | yes | yes |
| `npm run test:size` | bundle size | no | no | yes |
| `npm run test:perf` | filtered complexity checks, same fast config | no | via `npm test` | via `npm test` |
| `npm run test:e2e` | end-to-end | yes | no | no |
| `npm run test:all` | everything | yes | no | no |
| `npm run guard` | repository guard | no | yes (staged) | yes |

`npm run test:watch` re-runs the fast tier on change. `test:all` runs each execution tier once;
`test:perf` is a convenience filter, not a second configuration or an additional gate.

**Do not touch Obsidian while the e2e tier runs.** There is one app and one CLI; a stray
`obsidian eval` — opening settings, resizing a window — races the probe the tests are waiting
on, and the run hangs rather than failing. A suite that sat for 25 minutes with no output was
this, not a slow test.

Two more checks run in CI beside the fast tier: `npm run types` and `npm run lint`. The linter
carries Obsidian's own plugin rules and fails on any of them — see
[Obsidian compliance](Obsidian%20compliance.md). It runs from the repository root, because
several of those rules read `manifest.json` from the working directory and the manifest lives
in the root; the `lint` script changes directory for you.

The repository guard runs first, both on commit and in CI: it refuses stray tool output,
build results, big files, credentials and real home paths — see
[Repository guard](Repository%20guard.md), which also says how to allow something on purpose.

## Release integrity

CI uses read-only repository permissions and installs the exact locked dependencies without
install scripts. `npm audit --omit=dev --audit-level=moderate` checks shipped dependencies.

A tag created by `release.sh` must match both `manifest.json` and `plugin/package.json`.
The release builds with a read-only token; `plugin/scripts/check-release.mjs` rejects missing
assets, extra chunks, the development test API and sourcemaps. A separate publishing job,
which runs no npm commands, verifies SHA-256 checksums and attests build provenance.
`SHA256SUMS` accompanies the three plugin assets. After downloading them, verify with
`sha256sum -c SHA256SUMS` and `gh attestation verify main.js --repo <owner>/<repository>`.
These checks require no change to the existing raw-version tag convention in `release.sh`.

## Policy

New functionality is always covered by tests in the same change. Existing code gets covered
as it is touched. Prefer the fast tier — reach for e2e only when the behaviour genuinely
depends on Obsidian's runtime.

## Unit tier — `tests/unit/`

Small modules and pure functions without a running Obsidian. `tests/unit/pathsHelpers.test.ts`
is the pure-function model; adapter tests may use the mocked host API or a local HTTP server.
Keep real I/O explicit rather than describing those tests as entirely in-memory.

`tests/unit/designConformance.test.ts` is the odd one out: it reads the component sources and
enforces the rules in `Design.md` — no hand-styled `<button>`, no literal colours or pixel
sizes, no inline `style` attributes, no unexplained `overflow-x`. Each rule is there because
breaking it produced a visible defect at least once. These are source-pattern checks over an
explicit coverage list, not proof of component identity or computed layout. When adding a rule, prove it fails:
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

## Controlled scheduling

Use `tests/helpers/fakeClock.ts` at file or suite scope before its own hooks. Its returned
`advance(ms)` drains microtasks and advances the timers and animation frames without sleeping.
Unmount components and dispose services before returning to real time; the delayed-write guard
remains active on this clock. For a timer inside a fake operation, schedule its completion on
the fake clock; do not advance time from inside that operation.

Use `flushPromises` for promise chains that do not depend on time. For real I/O or WebCrypto,
wait for the observable completion with `vi.waitFor`; a fake clock cannot complete host work.
A check that nothing happens over a period still advances the entire period before asserting.

`tests/helpers/deferred.ts` provides explicit completions and one-shot `OperationDelays` gates.
Queue `holdNext`, start the operation, await `entered`, then `release` (or reject a write).
`fakeVault` exposes independent `frontmatter` persistence and `metadata` publication gates;
`FakeSettings` in `tests/helpers/fakeSettings.ts` has `load` and `save` gates and snapshots values
by copy. Immediate operation remains the default. Always release outstanding work in cleanup.
Known product ordering defects are pinned as `it.fails` with `BUG:` comments, not skipped or
weakened; a fix makes those cases fail until their expected-failure marker is removed.

## Harness tier — `tests/harness/`

Tests for the test infrastructure itself: CLI answers, screenshots, phone gestures, setup and
teardown, snapshot approval, configuration ownership and scheduling fakes. They run under the
same fast configuration without driving Obsidian or a phone. Isolated runner fixtures under
`tests/fixtures/harness/` are collected only by their own child-run configurations.

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
    ObsidianModal: { template: '<div><slot /><slot name="footer" /></div>' },
    Setting: { props: ['name', 'desc'], template: '<div><slot /></div>' },
  },
}
```

happy-dom has no `ResizeObserver`. A component that adapts to its own width needs a stub whose
callback the test fires with a chosen width — which is also how the narrow layout is driven,
rather than by faking a window size.

## Bundle size — `tests/size/`

`npm run test:size` builds the production bundle in memory (about 6 s, nothing is written to
`build/`) and fails when `main.js` or the stylesheet is over its budget in
`tests/size/budget.json`. Obsidian reads and compiles the whole of `main.js` on every start,
phones included, so every byte is paid for at load whether the feature behind it is used or
not. Raise the budget in its own commit explaining the growth; do not remove a feature to fit it.

The run also says where the bytes go — the heaviest packages in the console, all of them in
`/tmp/abele-bundle-size.json`. `node scripts/bundle-size.mjs` prints the same table without
the test. The split counts each module as Rollup rendered it, before minification, scaled to
the minified total: right about which package is heavy, not to the kilobyte.

The same build also checks the store's text scan for script-element creation, including
unreachable polyfill branches and namespace-aware element creation. JSZip uses its modular
entry with local `immediate` and `setimmediate` aliases; its prebundled browser entry embeds
legacy DOM-based schedulers that package aliases cannot replace. The fast tier exercises the
production aliases with async ZIP streams (including Lie's Promise fallback), optional desktop
Node streams and the real Word parser.

Runtime style-element creation has existing exceptions for document previews, the reader,
slides, snippets, script views and dependencies. The bundle check caps their existing literal
call sites at 12; it does not claim the plugin has no runtime styles. MapLibre's static stylesheet
has its own source guard. The size build reuses release validation for extra chunks, sourcemaps
and development markers rather than maintaining a second list of those checks.

The build runs in a process of its own. Built inside Vitest, whose environment leaks into Vite
and the Vue plugin, the same bundle came out 10–130 KB larger than the one `npm run build`
ships.

A dynamic `import()` does not make a dependency cheaper here: `inlineDynamicImports` keeps it in
`main.js` (see *The test hook* below), so its bytes are still read and compiled at every start —
a dynamic import alone does not guarantee that top-level evaluation waits until first use.

## Complexity tier — `tests/**/*.perf.test.ts`

Pins deterministic operation counts against the in-memory fixtures. These tests run in
`npm test`, including on commit and in CI, under `vitest.config.ts`. `npm run test:perf`
selects the same files from that configuration. Wall times may be reported for diagnosis;
complexity assertions do not depend on how busy the host is.

## Agent permission live checks

`agentRights.e2e.test.ts` checks the Skills folder setting in the desktop settings window,
Remember waiting for approval before storing anything, and a real script-started agent refusing
an Ask action. It also measures every approval button inside the card in a narrow sidebar,
under mobile emulation, and on the phone tier. Screenshots are kept with the run; inspect them.
Only a synthetic provider is used, and the settings, sample files and chat tab are restored.

## What the e2e tier covers

The live suite covers groups, tasks, finance, chats, scripts, settings, media, drawing, GitHub
and the reader on the targets each file declares. The list below describes representative
contracts, not an exhaustive inventory; `tests/e2e/*.e2e.test.ts` is the current file inventory.

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
  operation counts, while reporting the wall clock for diagnosis.
- `responsiveness.e2e.test.ts` — **UI stalls**. Samples a 16ms timer across a resolution and
  reports the longest stretch the main thread went unserviced. That stall is what the user
  experiences as input lag.
- `footerRender.e2e.test.ts` — **render cost**. Opens a wide group note and reports how much
  DOM its footer produced and how long the main thread was blocked. The component tier
  proves each list renders a single page; only this tier can show that the page is cheap.
- `chatStreamScroll.e2e.test.ts` — **reading a reply while it streams**, on the desktop and
  under `app.emulateMobile(true)` at 390×844. A scripted model (`window.fetch` answering a fake
  address) thinks, streams a long reply with a diagram and a chart in it, calls a tool and
  streams a second answer. Partway through the reader scrolls up to a paragraph below the chart;
  it must stay within 2 px of where they put it until the whole turn has ended and settled, and
  the chat must not end up at its end. The chart's block shows a placeholder while it is being
  written, never a chart error, and is drawn once the reply is done.
- `commentChats.e2e.test.ts` — **comment chats end to end**. Runs the comment command on a
  selection in a scratch note and checks what the app shows: no raw `%%c:…%%` in the editor, an
  icon carrying the comment id, the chat file under the comment folder, nothing drawn in the
  margin and no dialog over the note. Then presses the icon: the comment opens as a tab in the
  AI sidebar with the way back to the passage, the way up into a full chat and the note button,
  and a second marker pressed replaces that tab rather than adding one. The same press is made
  again under `app.emulateMobile(true)` in a phone-sized window, where the sidebar is the whole
  screen. Cleans the note, the file and the window size up after itself.
- `scriptChats.e2e.test.ts` — **chats under a script**. Opens a scratch script in the code view,
  attaches a scratch chat to it with the command, and checks the card is drawn under the code,
  that pressing it opens the chat in the sidebar while the script's tab stays, that a rename
  keeps the link, and that the card's unlink button detaches it. Removes both files after.
- `notePicker.e2e.test.ts` — **a filtered note picker in a script's form**. Writes three notes and
  a script asking for a wallet by `type`, runs it as a command, and checks that Obsidian's own
  suggester comes up over the dialog offering only the notes the filter lets through, that a note
  is found by its title, and that `form()` answers with a path and a list of links. Removes all of
  it after.
- `dialogRings.e2e.test.ts` — **focus rings in the chat dialogs, on the desktop**. Focuses every
  focusable thing in every tab of the setup dialog and in the history, and measures its ring
  against every ancestor that clips: a box standing flush with the content cuts the ring a field
  draws outside its box, which happened twice in one day. The icon picker, the MCP server form,
  the list of keys and every dialog `openDialog` opens by name (`src/testing/openDialog.ts`) are
  measured the same way.
- `dialogScroll.e2e.test.ts` — **dialogs taller than the window, on the desktop**. Makes the
  window short, fetches forty tools into the MCP server form from a stub, and opens the list of
  keys and a long script form: nothing may be cut off by a box that clips without scrolling, the
  last line has to come into sight when scrolled to, and the MCP form's Save has to stand on
  screen without any scrolling at all.
- `phoneLayout.e2e.test.ts` — **every dialog, on a phone**. Switches the app to
  `emulateMobile`, sizes the window to an iPhone (390×844), opens the chat, the settings dialog
  tab by tab, the history and every dialog `openDialog` opens by name — each of those must stand
  whole on the screen with the buttons of its pinned row in sight — and asks each screen the
  questions a phone-width layout fails:
  nothing past the right edge, a tab strip on one row and not shrunk below its tabs, at most one
  scroller inside the body and none capped at a desktop `max-height`, a sheet the height of the
  screen. Seeds a dozen skills and prompts so the lists have something to fill with, and removes
  them. Writes a PNG of every screen to `/tmp/abele-phone/` — **look at them before a release**;
  the 1.18.0 dialog passed every measurement anyone had thought to make and was still wrong to
  the eye. Restores desktop mode and the window size after itself.
- `taskTimelineScroll.e2e.test.ts` — **folded history and stable task anchors**, in the sidebar
  and note footer, at desktop and phone width and on the real phone. Checks that upward input
  stays native and never reveals history, using CDP wheel input on desktop, CDP touches under
  phone emulation and slow physical swipes on the phone. Measures the owner's displacement against
  the input distance (allowing native touch slop) and rejects a snap-back after release; no manual
  scroll positioning is used during the measured gesture. One banner click reveals every past day
  with the visible row held within 1 px. Also measures completed-toggle anchors within 1 px, short-list spacer
  cleanup, and a past-row anchor after reopening. On desktop, renders a frozen pre-history stylesheet on
  the same live DOM/build/theme path (retaining only the intentional new banner rule), captures
  the original date block in place, and asserts identical bounds and zero changed pixels. A
  one-pixel row translation must fail the comparison. The counted banner stays available to hide
  history again: hide/reveal cycles hold surviving rows within 1 px; hiding the read past region
  puts the nearest remaining row at its read position. Short-list collapse releases unnecessary
  spacer room, and reopening a footer restores both revealed and hidden history states.
  The reference build is cached under
  `plugin/node_modules/.cache/timeline-style-reference/` with its own locked dependencies;
  before/after/canary pictures go to the run's `task-timeline` screenshot directory.
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
  shows a keyboard, so the ways a platform makes room for one are mimicked in a 390×844 phone
  window: the dialog's container made shorter by hand (the page shrinks, the dialog's `vh` cap
  does not), `window.visualViewport` replaced by one reporting the smaller height, and the
  keyboard's height written as Obsidian's iPhone app writes it. In each the dialog stands in the
  room the keyboard leaves, its body scrolls there, the time field is in sight and the buttons
  stand above the keyboard. Writes one task note for the run and removes it; pictures go to
  `/tmp/abele-phone/task-date-*.png`.
- `composerActiveEditor.e2e.test.ts` — **editor commands after the chat was used**. A note is
  open, the chat's composer is typed into, then the focus goes back into the note, or nowhere as
  the command palette takes it: an editor command then changes the note, and never the composer.
- `composerExpand.e2e.test.ts` — **the chat's composer**. The field is Obsidian's note editor in
  live preview; its button opens it out over the whole chat and back with the draft kept; `[[`
  brings up the link suggester; a pasted and a dropped file become attachments; Shift+Enter sends
  the markdown as written to a scripted model. Then on a phone at 390×844, the keyboard written as
  Obsidian's iPhone app writes it: opened out, the field, the line being typed and Send stand above
  the keyboard and Obsidian's toolbar over it. Pictures in `/tmp/abele-phone/composer-*.png`.
- `formKeyboard.e2e.test.ts` — **typing into a long form on a phone, keyboard up**. A script's
  `form()` of twelve text fields and a note field, under `emulateMobile` at 390×844 with the
  keyboard written as Obsidian's iPhone app does: the last text field and then the note field,
  line after line, are typed into with real key input, and what is typed — the note field's caret
  — has to stand above the keyboard and Obsidian's editing toolbar, with Run in sight. On a phone
  the fields are tapped and typed into with the system keyboard. Pictures in
  `/tmp/abele-phone/form-keyboard-*.png`.
- `taskDateTablet.e2e.test.ts` — **the same dialog on a tablet, keyboard up**. Obsidian's tablet
  layout (a 1180×820 window and a taller portrait one under `emulateMobile`) stands the dialog
  in the middle of the screen. The keyboard's height is written as Obsidian's iOS app writes it:
  the bar a hardware keyboard leaves must move nothing, a full keyboard moves the dialog up only
  by what it covers, the time field and the buttons end up above it, the dialog keeps its size,
  measuring the keyboard again moves nothing, and the keyboard gone puts it back. Pictures go
  to `/tmp/abele-tablet/task-date-*.png`.

- `linter.e2e.test.ts` — **the linter**. Writes a folder of notes and a `// @lint` script for the
  run, lints the folder into the linter's tab and checks the findings, the script's among them;
  presses a line and checks the note opens at it beside the tab; presses Fix all, answers its
  question, and checks each note's new text and that only what cannot be fixed is still listed.
  Then at 390×844 under `emulateMobile`: nothing in the tab or in a fix's preview reaches past the
  screen, pictures in `/tmp/abele-phone/linter-*.png`. Puts the notes, the script and the linter
  settings back.

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
  checks the reader keeps clear of the floating header and bar and that the text starts within
  48px of the header, turns a page by a tap and by a synthetic swipe, opens the contents drawer
  (and picks a chapter from it) and the text and layout dialog; pictures in
  `/tmp/abele-phone/book-*.png`. WebKit itself cannot be run here.
- `bookPdf.e2e.test.ts` — **PDFs**, drawn by Obsidian's own PDF.js, with two PDFs written byte by
  byte in `tests/fixtures/books/pdfFixture.ts`: the pages draw with a text layer; the outline is
  the contents; keys, an internal link, a web link and outline entries go where they should; the
  page is kept; page size and dark pages follow the settings; PDFs open here by default — a click
  in the file explorer, a link — even over the old switch's stored `false`, the setting gives `.pdf`
  back to Obsidian's viewer and, turned on again, moves a PDF tab open there into the reader; the
  file menu offers **Open in Abele reader**. A hostile PDF — JavaScript on opening, behind a link, in a form field and in the names
  tree, a `javascript:` and a `file:` address, a launch action — is opened with both sandboxes and
  every link on it clicked: nothing may run, open, alert or ask for `child_process`. The phone file
  opens a PDF too, and checks the page fits the screen and turns by a tap and a swipe.
- `bookHighlightWords.e2e.test.ts` — **a highlight drawn over its own words**, desktop and phone
  (`tests/fixtures/books/justifiedBook.ts`, made-up justified prose): a highlights note written by
  hand, one highlight whose place is the end of one paragraph and whose words end a paragraph
  further on, one whose place and words agree, one whose words are nowhere in the chapter. The
  boxes drawn must stand on the words, not on the paragraph the place names, for the first, and on
  the place for the others.
- `bookHighlights.e2e.test.ts` — **highlights, links and search**, with the rich book and the plain
  PDF in a folder of their own: words selected on the page are highlighted into
  `<book> highlights.md` (its exact callout checked) and drawn; a tap on the highlight opens its bar;
  recolouring, a comment and removing each change the note; a callout written into the note by hand
  is drawn at once; a link to selected words has the expected shape, a quote of them goes into the
  note last open, and following such a link opens the book there with the words selected; a search
  lists finds by chapter and goes to one. The same for the PDF: highlight boxes over its text
  layer, a search page by page that selects the find, and a `#cfi=` link in the highlights note,
  clicked in reading view while PDFs open in Obsidian's viewer, opening in the reader with the words
  selected. The phone file adds the search in the drawer and the bar for selected words at 390×844.
- `bookAgent.e2e.test.ts` — **the agent and books**: the book tools called as a chat calls them,
  with the chat's scope set to the run's folder. `book_views` quotes words selected on the page
  with their link; `book_contents`, `book_read` (a part, the next window, and from a link a search
  gave) and `book_search` read a book that is not open; `book_open` shows a place in the book's
  own tab with the words selected; a PDF is read by its pages; a scope without the book refuses
  it and `book_views` counts its tab as outside; **Ask here** on selected words opens a chat whose
  input is the link and the quote. The scope and the AI switch are put back after.
- `bookPdfScroll.e2e.test.ts` — **a PDF as one continuous scroll**, with a forty-page PDF written
  for the run: the scroll renderer is the one in use, only pages near the screen have frames (and
  the first is dropped once far away), the page being read follows the scroll into the progress
  line; links and the outline go to their page and the page is kept across closing the tab; zoom
  by the keys and by a pinch (Ctrl+wheel) grows the pages and keeps the page, and Mod+0's reset
  returns to the setting; switching to pages and back keeps the page. On a phone at 390×844 the page
  fills the width, keeps clear of the bars and scrolls; picture in `/tmp/abele-phone/`.
  `bookPdf.e2e.test.ts` and the phone file run with pages turned one at a time.
- `bookPdfInk.e2e.test.ts` — **drawing on a PDF's pages**: a pen sent through the app's own input
  (`Input.dispatchMouseEvent` with `pointerType: 'pen'` and a pressure) draws on the page it is
  over, with more than one width; the page's SVG appears beside the book and its callout in the
  book's note; undo, redo, the eraser (file and callout go, and come back with undo), the mouse and
  the marker; a finger moves the pages and draws nothing; listeners on the document and the window
  — where Obsidian's are — hear nothing while drawing; stopping hands the row back. Opened again
  the ink is there, and a change to the file (another device) is drawn. Pages turned one at a
  time: the pen draws and a finger's swipe turns. At 390×844 the bar fits its row and a finger
  draws; at 820×1180 (a tablet) a finger moves the pages. Pictures `/tmp/abele-phone/ink-*.png`.
- `bookFormats.e2e.test.ts` — **the other formats**, with files written byte by byte in
  `tests/fixtures/books/otherFormats.ts` and `richBook.ts`: a Mobipocket book, a FictionBook bare
  and zipped, a comic archive and a fixed-layout EPUB, each carrying scripts, handlers or runnable
  links. Each opens from its file, every part is visited and every element clicked, with the
  desktop's sandbox and the iPhone's: its text shows, no script is in any page, nothing runs or
  opens. The comic's pages come in numeric order; a Kindle book whose header says it is encrypted
  says it is protected by DRM; words on a fixed page are highlighted with boxes; `book_read` and
  `book_search` read the Mobipocket and FictionBook files.
- `bookSelecting.e2e.test.ts` — **selecting on pages turned one at a time**: with the mouse on the
  desktop — at 1280×800 with both side panels closed, so the page has the two columns its steps
  assume — then under `emulateMobile` at 390×844 with touches sent through the app's own input
  pipeline (`Input.dispatchTouchEvent`, from inside the app so a long press lasts as long as it
  says). Only a clean tap at an edge or a swipe turns the page; the mouse let go at the very edge
  after dragging a selection there turns nothing; a long press, a finger held and
  moved, a swipe or tap over a selection, a tap on a highlight, a tap beside an open bar and taps
  on the bars' buttons do not. A selection held at the edge or tapped on its edge moves the page on
  by half — one column of two on the desktop, a scroll of half the page, in the page's own box, on
  a phone — keeping the words just selected on screen, and grows onto what came — with the mouse,
  with a finger, and with only its end moved, as iOS's handles do — and is highlighted as one; let
  go, the pages come back on the page where it ended. A chapter scrolled by choice moves half a
  screen. The bar is hidden while words are being selected and comes back once they rest, in the
  row under the page in place of the line with the slider, as tall, the page not laid out anew —
  and the bar for reading aloud the same. It stops at the end of the chapter and in a PDF at its
  page, and says so.
- **The iOS lab** (`plugin/tests/ios/`) — the reader's engine and page wiring in a plain page, run
  in Safari in the iOS Simulator: the real WebKit, with its own long press, selection handles and
  scrolling, which Chromium's emulation does not have. No emulator runs Obsidian, but this is the
  part of the reader that talks to WebKit. Start the server with `node tests/ios/run.mjs` (it
  bundles `lab.ts` with the project's esbuild, the `obsidian` module stubbed), boot a Simulator
  iPhone (`xcrun simctl boot <id>`) and open `http://localhost:8787/?flow=paginated` (or
  `scrolled`) with `xcrun simctl openurl`. The page reports every selection change, scroll,
  relocation and touch event to `/tmp/abele-ios/log.jsonl`. `tests/ios/play.sh <id> '<steps>'
  [picture]` plays gestures — press, drag with a hold, tap, wait, in points of the screen — through
  a UI test that drives Safari (`tests/ios/driver/`, an Xcode project of a host app and the test,
  built once into `/tmp`), prints the log and pictures the screen. It needs Xcode and an iOS
  Simulator runtime, nothing else. What it showed: while a selection
  handle is dragged WebKit sends the page a touchstart and nothing else, and a handle dragged
  below a page's text selects to the end of the chapter — or, as often, to the page's last line.
  With it the reader's hold at the foot of the page was checked for real: a long press, the end
  handle dragged down and held, the page turning with the selection carried on and the handle
  dragged further on the new page; and a tap on the page's edge with words selected.
  `?ink=1` (with `&finger=1` to let a finger draw) opens the drawing sheet over four page frames
  instead: it logs every touch it routes, each stroke's points, any event that reached the
  document, and any scroll. What it showed on a Simulator iPad: a finger stroke arrives as a full
  stream of points and is drawn inside the page frame; a long press draws a dot and opens nothing;
  nothing reaches the document; with the finger moving the pages, the scroll follows and glides.
  The Simulator has no Apple Pencil, so pen, pressure, the palm and Scribble are the iPad's to show.
- `bookPhoneControls.e2e.test.ts` — **the reader's controls on a phone**: the progress slider
  dragged does not open the side panel; the text and layout dialog scrolls to its last row and the
  note and comment dialogs show their buttons; a dialog with a search field keeps its size under a
  keyboard mimicked as Obsidian's iPhone app reports it, and its list scrolls up above it; with
  `tests/fixtures/books/figureBook.ts`, a lone picture is centred, a small one left alone, a wide
  table scrolls sideways without turning the page, a tap opens either full screen (pinch, fit,
  swipe down), and turning the phone keeps the place. Pictures in `/tmp/abele-phone/controls-*`.
- `bookPlaces.e2e.test.ts` — **where a book was left, across a restart**: a book and a PDF read to
  a place, the window reloaded with their tabs open, the restored tabs open where they were and
  the file of places in the vault still holds them; then a later place written into that file on
  disk, as a sync from another device would, moves the open book on to it, and it stays in the
  file. The file is removed afterwards, so the fixture vault holds only what it did.
- `bookLayout.e2e.test.ts` — **paragraphs never drawn over each other**: a book of long Russian
  paragraphs with footnote marks (`tests/fixtures/books/proseBook.ts`) on the desktop in two
  columns and one, and on a phone. After each thing that lays the pages out again — the window
  resized, side panels and the contents panel opened and closed, a column's step and the return
  to a page's edge, the chapter scrolled for a while and turned back into pages, the book restored
  when the app starts — every line of every paragraph in the chapter is compared with the lines of
  the paragraphs after it. The probe is first shown paragraphs made too short on purpose, so a pass
  means something. It also opens the book with a saved place the book does not have (another
  edition under the same identifier), which opens it at its start instead of failing, and has
  the page's fonts arrive (`loadingdone`): the columns are laid out again and nothing on the page
  moves.
- `bookMarksFollow.e2e.test.ts` — **highlights follow their words**: on the desktop in two
  columns, a paragraph above a highlight grows by a couple of lines while the chapter keeps its
  page count (what a late picture, font or style does), and every box drawn over the page is
  compared with where its words now are; again after a page turned and back.
- `bookOverlayReflow.e2e.test.ts` — **search boxes and saved highlights after reflow**, desktop,
  phone emulation and real phone: compares all four dimensions of the drawn SVG rectangles with
  independently located text ranges after the reader sidebar opens and closes, a desktop resize,
  a reader font change, Electron zoom 90%/110%, and a late paragraph style change that moves
  words without resizing their block. The late change happens after the startup font checks have expired. Pictures go to
  `abele-overlay-reflow` under the run's screenshot directory.
- `bookOverlayOrigin.e2e.test.ts` — **a new overlay starts at its frame's origin**, desktop and
  real phone. Checks actual search and saved-highlight rectangles in the attachment microtask,
  before resize observers can repair a wrong origin, then after sidebar changes, a delayed vault
  font, returning to a chapter, two-column layout and scrolling. A generated font file exercises
  the fonts-folder path; a tall desktop viewport exercises one visible column with two enabled.
- `bookDeviceReflow.e2e.test.ts` — **real phone to desktop handoff**, an opt-in paired-device
  test in the phone tier. The caller must also lease a desktop vault, install the same test
  build there, and name it with `ABELE_READER_DESKTOP_VAULT`. Without that second lease the test
  does not run. It creates highlights and reading positions on the real phone, copies the
  actual places record and note through the vault-file arrival boundary, opens the desktop
  at that position with a delayed real vault font, and then delivers a second place recorded
  on the phone after the desktop has opened. No CFI or timestamp is synthesized. Checks all
  current-chapter highlight/search boxes after rendered frames, through sidebar/column changes
  and Electron zoom 90%/110%, and asserts that reflow does not echo a new reading position or
  timestamp. Both devices' settings and files are restored; the caller releases the desktop
  lease. This tests the reader's sync-file boundary, not a hosted sync service's transport.
  Optional `ABELE_READER_LOCAL_CASE` points at an untracked JSON diagnostic case: `font`
  (`family`, host `files`, vault `folder`), initial Electron `zoom` and sidebar `panel`; an
  external `book` also supplies its identifier `key`, two `targets` (`index` plus `text`) and
  search `query`. These assets and reports stay local; the default fixture remains invented.
- `bookNestedWrappers.e2e.test.ts` — **nested inline wrappers around whole chapters**, desktop
  and real phone. Every inline ancestor of block content must lay out as a block while plain
  inline words remain inline (also unit checked). Moving between later paragraphs must save
  distinct, nonempty ranges containing their actual text, not a collapsed chapter-body CFI.
  This catches wrapper bounds that make the visible-range walker prune text in later columns.
- `bookFontReflow.e2e.test.ts` — **real font metrics arriving late**, desktop and real phone.
  Reads a TrueType font from the test host (`ABELE_TEST_FONT_FILE`, defaulting to the macOS
  Times New Roman file), gives its temporary copy a test-only family so the installed font
  cannot bypass the delay, and writes it into the test vault's fonts folder. No font binary
  is committed. Holds its arrival past the startup repair timers, then compares every saved
  highlight rectangle and the target search frame with independent text ranges within 2 px;
  repeats after section changes, the sidebar, two columns and reopening the book. A canary
  requires the late face to move the text enough that the old rectangles would fail. The
  temporary book, font and note are removed and device e-ink mode restored afterwards.
- `bookSelectionPlace.e2e.test.ts` — **a word is selected where it is drawn**, desktop and phone
  (`tests/fixtures/books/latvianBook.ts`, made-up justified text in a monospace font): for every
  word on the page, the middle of its measured box must hit that word, once the page has settled
  and again after its style changed; on the phone a real long press in the middle of a word must
  select that word with its selection box on it. iOS WebKit measured such a line as if it were
  not stretched while it drew it stretched. Picture in `/tmp/abele-phone/selection-place-held.png`.
- `bookStyles.e2e.test.ts` — **a book's own styles** (`tests/fixtures/books/styledBook.ts`): a
  linked stylesheet importing another shows its indents, alignment, table and drop cap; its fixed
  text size follows the reader's; no request leaves for the rules pointing outside the book; turned
  off, the page loses them at once. Its text in a wrapper with wide side margins and a monospace
  font gets the reader's margins and font; a quote keeps its indent. The e2e fixture EPUB opens with its rules and without its web
  picture. Pictures in `/tmp/abele-phone/styles-*.png`.
- `bookNoteSpans.e2e.test.ts` — **notes wrapped in spans** (`tests/fixtures/books/notesBook.ts`,
  made-up text): each note a `span` around its number's `div`, sometimes a superscript paragraph,
  and its paragraph. The span is a block, the places saved name the book's own elements, and every
  line of a highlighted note is under the paragraph (not its number) with a box drawn on it. A
  picture loaded after the chapter lays the columns out again.
- `bookBookmarks.e2e.test.ts` — **bookmarks**: the bookmark under the page marks the page and
  fills, turning on empties it, the Bookmarks tab lists it with its chapter and words and goes back
  to it, a text size of 150% keeps it on its words, the file in the vault holds it, `book_views`
  lists it, and a removal written into the file on disk, as another device's sync would, takes it
  away; a PDF page is marked with its words and known again. Then on a phone at 390×844: the
  button inside the screen and the list inside the drawer, pictures in
  `/tmp/abele-phone/bookmarks-*`. Both files are removed afterwards.
- `bookNotesFile.e2e.test.ts` — **where highlights go**: with one note for every book and a
  template set, the first highlight makes the note from the whole template and the second adds
  only its body; the book's Aa dialog sends the book to a note of its own, the next highlight is
  written there (still marked as the book's), the book shows all three, and removing one from the
  shared note takes the heading its body wrote. The reader settings are put back and the folder
  removed afterwards. The rules themselves — the choice for every book and for one, a template's
  parts, a note several books share — are unit tests (`bookNotes.test.ts`,
  `bookNotesVault.test.ts`, `bookNotesSettings.test.ts`).
- `bookSpeech.e2e.test.ts` — **reading aloud**, with the platform's speech swapped for a stand-in
  (`window.__abeleTest.reader.hooks.speech`) that records each sentence and ends it a moment later,
  so nothing is heard. With the rich book and the plain PDF: the header's button reads from the
  page on screen, the sentence marked, and goes on into the next chapter; pause, go on, skip and
  back do what they say; closing the tab stops it; **Read aloud from here** starts at the selected
  words in the chosen voice and speed; a PDF is read a page at a time with a box over the sentence,
  turning to the next page. Last, it checks the app has platform voices, English among them.
- `bookDarkPictures.e2e.test.ts` — **pictures in a dark theme**: a book whose diagrams are dark
  lines on transparency (a PNG with alpha, an SVG file in an `img`, an SVG in the page) is opened
  in a dark theme; each picture on screen must show light paper with dark lines on it, measured
  from a picture of the window (`/tmp/abele-dark-pictures.png`).
- `bookReading.e2e.test.ts` — **reading**, on the desktop, with the book of
  `tests/fixtures/books/richBook.ts`: a note marked as one and a note marked only by a superscript
  open in the dialog; a link to another chapter is followed and the way back works; the contents
  sit beside the page and go to a chapter; the place is kept across closing the tab and across
  renaming and moving the file; a change of the text and layout settings and a switch to a dark
  theme redraw the open page. Puts the settings and the theme back after itself.
- `historyTimeline.e2e.test.ts` — **the history timeline of a base**, with the made-up history of
  `tests/fixtures/history/historyNotes.ts` (rulers, thinkers, scientists, artists, events and
  eras, dated as people write: `-470`, `490 до н.э.`, `ок. 1450`, `1450?`, `XVI век`, `period`),
  grouped by `category`. The rows and eras are drawn, 470 BC lands at year -469, a name typed in
  the go-to field picks that person and lists their contemporaries with the years shared, a press
  picks a bar and Escape lets go, the card over a bar shows its round picture, Ctrl with the wheel
  zooms about the pointer, **New note** writes the year into the start; light and dark pictures.
  Then two thousand notes more: the first drawing and a frame of moving stay quick. On a phone
  (390×844 under `emulateMobile`, or the real one): nothing past the edge, a finger's tap picks,
  two fingers zoom. The canvas keeps what it drew on `canvas.abeleHits`, which is how the test
  finds a bar by name. Pictures in `/tmp/abele-phone/timeline-*.png`.

- `sync.e2e.test.ts` — **sync, with nothing stubbed**. Starts the sibling repository's sync
  server and daemon, opens a vault of its own in the running Obsidian with this branch's build in
  it, and pairs it the way the Sync tab does. Then: a note made in Obsidian reaches the daemon
  folder; an edit on each side merges into both; in conflict-file mode the second edit lands as a
  copy, in Obsidian too; a PNG arrives byte for byte; an older version comes back through the file
  menu's version history, read off the editor; a deleted note comes back through the deleted-files
  command; and the plugin logged no error throughout. Needs more than the rest — see
  [The sync suite](#the-sync-suite).
- `syncPhone.e2e.test.ts` — **the sync screens on a phone**: in a vault of its own, filled with a
  note of fifty versions, forty deleted files and a long log, the history, its diff and its restore
  confirmation, the deleted files, the log and the Sync tab paired and not, at 390 and 320 wide under
  the phone's emulation and with their focus rings on the desktop. Pictures in `/tmp/abele-phone/`.
- `syncJoin.e2e.test.ts` — **joining a vault that already has files**: the question asked as a
  download, an upload, a choice or a reconnect; **Merge both** keeps both texts on both disks;
  **This device wins** puts this device's note everywhere with the server's in its history, while
  Abele's own settings stay the vault's; **The server wins**, answered in the join dialog from the
  sign-in card, keeps the server's note with this device's in history; and a transfer's receipt
  waits in **Choose how to join** until the Sync tab's dialog is answered.
- `syncDeletes.e2e.test.ts` — **many files deleted at once**: sixty deletes held, **Put them back**
  and **Delete everywhere** from the dialog, **Restore all deleted since** the last hour, two
  Restores pressed back to back, a hold answered twice on the Sync tab while paused, **Sync now**
  while paused, and no empty folder left or offered after a rename on the other device.
- `syncSettings.e2e.test.ts` — **settings that travel**: Abele's settings file reaches the other
  device without the chat index and a change from there is reloaded once; Obsidian's settings from
  the other device are asked about, and **Keep this device's**, **Later** then **Apply and
  reload**, and **Reload now** each do what they say, with the reload counted through
  `settingsPrompt.reloader` rather than run; a local change to a waiting file goes out instead.
- `syncDevices.e2e.test.ts` — **the devices on a vault**: the Sync tab's list with a transfer's
  device marked as enrolled by this one, **Revoke** on the daemon (its next sync is refused),
  **Disconnect** telling the server while the transfer's device stays enrolled, and a Disconnect
  with the server down waiting to tell it until **Forget without telling the server**.
- `syncDialogs.e2e.test.ts` — **the phase-3b sync screens on a phone**: the held-deletes dialog
  and its confirmation, the settings question, **Restore all deleted since** in each preset and
  its confirmation, the Sync tab holding all of it with the device list and the Revoke
  confirmation, the join dialog as a sign-in and a transfer open it, and the waiting-to-tell line
  and its confirmation — at 390 and 320 wide under the phone's emulation, with their rings on the
  desktop too. Also, as a phone, that a note made in front reaches the server with nothing else
  done, and one made just before the app leaves the front too. Pictures in `/tmp/abele-phone/`.

Correctness runs on small groups so it stays quick; cost and responsiveness run on the wide
"mega group" to expose work that grows with the transitive closure. The former multi-minute
rescan is not the current performance baseline.

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

Several runs can go at once in one app, each pinned to its own copy of the fixture vault.
What would leak between their windows is kept per window: phone emulation (Obsidian keeps it
in one `localStorage` key every window reads when it starts — every reload goes through
`reloadApp()`, which sets it only for the moment its own window starts), keyboard focus (only
the frontmost window has it — each file turns on `Emulation.setFocusEmulationEnabled`), and
the settings popout (found by its title, which names the vault). A test that reloads the app
or switches emulation must do it through `reloadApp()`, never `app.emulateMobile()` itself.

An explicitly requested e2e run fails if Obsidian is unavailable or the vault lacks the
development test API. The reporter also fails a run in which every collected test was skipped
or no tests executed. Use `npm test` for offline verification, not `test:all`.

Missing group or relation snapshot baselines fail without writing anything. Only the explicit
`UPDATE_GROUP_SNAPSHOT=1` or `UPDATE_RELATIONS_SNAPSHOT=1` flag approves a new baseline; review
that diff before committing it.

### Load time

`loadTime.e2e.test.ts` switches the plugin off and on again inside the running app seven
times — Obsidian's own `disablePlugin` / `enablePlugin`, which re-reads `main.js` and evaluates
it afresh — and compares the median of each phase with `tests/e2e/loadTime.baseline.json`.
The phases come from performance marks the plugin leaves as it starts
(`src/helpers/loadMarks.ts`; the first one is prepended to `main.js` by the build): reading and
compiling the file, the bundled modules running, `onload()`, the layout-ready work, the whole
enable call, the next painted frame, and the moment the main thread has gone half a second
without a 50 ms stall. The marks are in production builds too — they cost microseconds.

- **In two fixed workspaces.** What is open decides most of a reload: registering the editor
  extensions redraws every open note, footer and all, and every open Abele view is mounted
  again. So the probe replaces the whole workspace with a known layout before measuring and puts
  the old one back after: `bare` (nothing open, the plugin's own cost) and `workspace` (a
  fixture note, the agent chat and the timeline — about four times as long). Each has its own
  baseline.
- **Per build.** A development build carries the test hook and a 20 MB inline source map that
  Obsidian strips before evaluating, so its numbers are kept apart from the shipped build's.
  The test reads which one is installed and compares against that baseline.
- **Tolerance** is per phase in the baseline file: a median fails when it is over both
  `factor` × baseline and baseline + `slackMs`. Loose on purpose — it is there to catch a
  load that doubled, not a 10 ms drift.
- `ABELE_LOAD_BASELINE=update` rewrites the baseline for the installed build instead of
  comparing. Do it deliberately, in the diff that made loading slower or faster.
- `ABELE_LOAD_COLD=1` also restarts the window three times and reports where the marks fall
  during a real app start, in ms from the window opening. Reported, not compared: an app start
  also indexes the vault and loads every other plugin.
- `ABELE_LOAD_RUNS` changes the number of reloads. Numbers land in `/tmp/abele-load-time.json`.

On a reload the layout is already there, so the layout-ready work runs inside `onload` and is
nearly all of it — against the 12,000-note fixture 90–140 ms of indexing tasks, finance and
time entries, growing as the rest of the tier leaves notes and chats behind in the fixture. On
an app start `onload` itself takes a few milliseconds and that work runs once Obsidian has
restored the workspace.

### A reload must not keep the previous load alive

Obsidian evaluates `main.js` afresh every time the plugin is switched off and on — a reload, an
update, a toggle — and anything the old copy left reachable from the page holds that whole copy.
Vue's global setters (`src/helpers/vueGlobals.ts` takes this bundle's back on unload) and the
reader's custom elements (registered on first use, see `src/vendor/foliate-js/README.md`) each
did: a development build leaked about 65 MB per reload, until the window's renderer crashed half
way through the e2e tier. To check for another one: tag the plugin instance
(`app.plugins.plugins.abele.__marker = new (class LeakMarker {})()`), reload it twice, force a
collection (`obsidian dev:cdp method=HeapProfiler.collectGarbage`), write a snapshot from the app
with `require('v8').writeHeapSnapshot(path)` and walk the retainers of `LeakMarker`. A
development build keeps one previous copy through Vue devtools' globals; that one is bounded.

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
- **A window that is not drawn is refused.** Throttling off keeps timers running, but a window
  nobody can see — the screen locked, above all — is drawn once or twice a second, and every
  input sent through the DevTools protocol waits for a frame: a 60 ms tap reaches the page as a
  one-second long press. The file stops at once, saying so, when the window draws fewer than 15
  frames a second, rather than failing its gesture tests as if the reader were broken.

The CLI calls themselves are killed with `SIGKILL` at their timeout — a CLI call that never
gets its answer ignores `SIGTERM` — and a call answered with `Error: Command "…" not found`
(the app is there but still loading) is retried rather than parsed as a result.

### Known rough edge

The CLI helpers call `execFileSync`, which blocks the worker's event loop for the whole
duration of an `eval`. When two multi-minute files run in the same invocation, Vitest can
report `Timeout calling "onTaskUpdate"` alongside otherwise correct results. Running the
long files one at a time avoids it. The real fix is to move the helpers to async `execFile`.

### On a real phone

The same files can run on Obsidian on a real phone, cabled to the machine that runs the tier:

```bash
npm run test:e2e:phone          # E2E_TARGET=phone
```

A file takes part by saying so at its top — `targets('desktop', 'phone')` from
`tests/e2e/helpers/target.ts`. The e2e config reads that call from each file's source: a phone
run loads only the files that name the phone, and a file with no call is a desktop file, so the
desktop run is what it always was. The `targets(...)` declarations, not a hand-maintained list
here, are the source of truth for phone coverage. A desktop file using `emulateMobile` is not
a real-phone check unless it also declares the phone and implements that target. Examples of
phone contracts include `taskDatePhone` (the system keyboard), `formKeyboard` (typing through a
long form), `chatOpenPhone` (opening chats without losing the note), and `footerTaskClick`
(task actions without moving the note). Inspect the declaration before selecting a file.

**The phone driver.** The repository does not know how to reach a phone. Everything goes
through a command on the machine, named by `ABELE_PHONE_DRIVER` (default `iphone`), which has
to answer:

| Command | What it does |
|---|---|
| `doctor` | one line per part, `OK …` or `FAIL …`, exit 0 when the phone is ready |
| `take NAME --wait --pid PID`, `drop NAME` | the lock that gives one user the phone, held under a name: `take` prints `taken`, or `already yours` when the lock is under that name already; the pid only frees a lock whose process died; `drop` turns the screen off first. Every other command carries the holder's name in `IPHONE_LOCK_OWNER` |
| `launch BUNDLE` | brings the app forward and aims the touches and typing at it (`md.obsidian`) |
| `open-url URL` | opens a URL on the phone (`obsidian://open?vault=…`) |
| `push-plugin DIR MANIFEST VAULT` | installs a build (`main.js`, `main.css`) into a vault on the phone |
| `eval --envelope --timeout S CODE` | evaluates in Obsidian's page, prints `{"type","value"}` or `{"thrown"}` |
| `tap X Y`, `swipe X1 Y1 X2 Y2`, `longpress X Y`, `type TEXT`, `pinch SCALE` | real touches, in the page's CSS pixels |
| `call /swipe JSON` | optional-speed swipe for displacement probes: `x1`, `y1`, `x2`, `y2`, `velocity` in CSS pixels per second |
| `orientation landscape\|portrait`, `alert [BUTTON]`, `shot PATH`, `status` | the rest |
| `reverse PORT` | while it runs, `127.0.0.1:PORT` on the phone reaches the same port on the machine |

**What a run does** (`helpers/phoneHost.ts`, from `globalSetup`): takes the phone's lock for the
whole run — anything else that drives the phone takes the same lock and waits while it is held,
so two runs, or a run and another user of the phone, never touch it at once — under the name in
`IPHONE_LOCK_OWNER`, or `abele-e2e-<pid>` when none is set, and gives it back at the end with the
screen turned off, only if the run took it itself (a caller that set the name and holds the phone
keeps it); stops with the driver's own report when
`doctor` says anything but the plugin is down; builds the plugin like `build:test` into a scratch
directory (`ABELE_PHONE_BUILD` names a build to install instead) and installs it into the phone's
test vault (`ABELE_PHONE_VAULT`, default `abele-e2e` — a copy of the fixture vault, never a real
one), opening that vault by name if another is open, reloads and waits for exactly that version; starts a small server the page reaches through
a reversed port.

**Inside the page** the harness puts `window.__e2eHost` (`installPhoneHost` in
`helpers/phone.ts`, put back after every reload): `shot(path)`, `tap`, `swipe`, `longPress`,
`type`, `pinch`, `orientation`. `swipe(x1, y1, x2, y2, { velocity })` optionally requests a slow
pan rather than the driver's default flick; other swipes are unchanged. A probe that runs in the page tells the phone by it and uses it
where the desktop uses Electron — `capturePage()` becomes `shot`, a DevTools touch becomes a
finger. A probe that runs long goes through `evalLong()`: on a phone it is started in the page and
asked after every second, since a call that blocks the test worker for a minute ends the run. Pictures go to `/tmp/abele-iphone/` (`ABELE_PHONE_SHOTS`), so they never mix with the
desktop's `/tmp/abele-phone/`. A server a test starts on the machine (the fake GitHub, the
calendar feed) is reversed onto the phone with `exposeToPhone(port)`, so its `http://127.0.0.1`
address works in both places.

**What differs from the desktop.** A phone is a phone: `reloadApp('app.emulateMobile(…)')` is a
plain reload there, the window is the screen (measured, never resized), throttling and focus
emulation do nothing. What only a desktop has — the DevTools protocol (`dev:cdp`), the CLI's
console capture — throws `DesktopOnlyError`, and a test that fails with nothing else is reported
as skipped with what it needed. Where the desktop mimics something a phone has for real — the
keyboard's height, a finger's long press, turning the phone — the phone file does the real thing
instead: `taskDatePhone` taps the time field and measures the system keyboard.

### The sync suite

What follows is said of `sync.e2e.test.ts`, and holds for every `sync*.e2e.test.ts`: each makes a
server, an account, daemon folders and a vault of its own, and takes them away again.

`sync.e2e.test.ts` does not drive the vault the rest of the tier drives. It pairs a device with a
server and writes files, which is not something to do to anyone's notes, so it makes a vault for
the run and takes it away again.

What it needs, and what it says when something is missing:

- **Obsidian running with a vault open.** That window is only used to send the message that opens
  the test vault; nothing is written to it. It is `OBSIDIAN_TEST_VAULT` when set, else the window
  in front. Without one the suite skips.
- **The sync repository, built.** The server, its admin CLI and the daemon are taken from
  `abele-sync`'s own `dist`, never built here. It is looked for five directories up from
  `tests/e2e/helpers` — beside the repository in a plain checkout, beside the worktree's folder in
  a worktree, where a symlink to the real checkout does — or wherever `ABELE_SYNC_DIR` points.
  Run `npm run build` there first. Without it the suite skips, naming the path it looked at.
- **This plugin, built for testing.** `npm run build:test`, newer than `src/` and than the sync
  repository's `core` and `protocol` `dist`, which the bundle inlines. A missing, stale or
  production build fails the suite at once, saying so; it is not built for you, because a build
  takes longer than a test worker may stay silent.

```bash
npm run build:test
OBSIDIAN_TEST_VAULT=<vault> npm run test:e2e -- tests/e2e/sync.e2e.test.ts
```

It takes well under a minute. What it makes, and takes away at the end:

- a folder in the system's temp directory holding the server's database and blobs and the daemon's
  folder, and a server on a free port on `127.0.0.1`, killed at the end;
- a throwaway account on that server, with a made-up password;
- a vault, a folder named `abele-sync-e2e-<8 hex>` in the folder the suite keeps test vaults
  in (`VAULTS_DIR` in `tests/e2e/helpers/syncVault.ts`), holding the build, an
  `.abele-sync-ignore` that keeps its config folder out of the sync, and two settings the suite
  needs: menus drawn by the page (a native macOS menu cannot be clicked from a script) and
  Obsidian's own Sync switched off (it adds an **Open version history** of its own beside the
  plugin's **Open version history (Abele)**). It opens in a window of its own behind whatever is in front, with the vault's
  Restricted Mode turned off so the plugin loads.

At the end the device is forgotten, which drops its ledger and its keychain entry; the window is
closed; the folder is deleted; and the vault is taken off Obsidian's vault list, through the same
message the vault switcher's **Remove from list** sends. A window that will not close is left open
with its folder, and a warning names the path: close the window, remove the vault from the
switcher, then delete the folder.

The other sync files differ in a few ways worth knowing before a run:

- **Sign-ins are spaced out.** The server lets one address sign in ten times a minute, and a
  daemon's `init` counts as much as the plugin's sign-in. `syncJoin` signs in about eight times,
  so it waits between them (`beforeSignIn` in `tests/e2e/helpers/syncDriver.ts`) and takes a
  couple of minutes.
- **Some let part of the config folder through.** `syncJoin` lets Abele's own `data.json` sync;
  `syncSettings` and `syncDialogs` also let `app.json`, `hotkeys.json` or other plugins'
  `data.json` through. `main.js` stays out everywhere.
- **The questions need the app in front.** The held-deletes and settings dialogs are asked only
  while the page is visible, and the test window sits behind everything. The suites make the page
  say it is (`SyncDriver.inFront`) and undo it at the end.
- **`syncDevices` and `syncDialogs` kill their server part way,** for a Disconnect nobody answers;
  those cases come last. A token kept to tell that server is let go in `afterAll`.
- **`syncDialogs` turns its window into a phone** under the same reload lock as `syncPhone`
  (`tests/e2e/helpers/phoneWindow.ts`), and runs for several minutes.

Two things are left behind on purpose, as not worth the machinery that would avoid them:

- **The account's password is briefly visible in the process list.** It is an argument to the
  admin CLI's `create-account` and to the `obsidian eval` that signs the plugin in, for as long as
  each of those runs. It is a made-up password for an account on a server that lives only for the
  run.
- **Obsidian's profile can keep a trace of the device.** Where Obsidian's keychain cannot delete an
  entry, the token's entry (`abele-sync-device-…`) is emptied rather than removed. If forgetting
  the device fails — the suite warns `could not disconnect the test device` — the token stays in
  that entry and the ledger stays in Obsidian's IndexedDB as `abele-sync-<id>`. The token is for a
  server that no longer exists.

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

**Files that address `ScaleTest/` require the generated fixture.** These include `footerRender`,
`groups`, `noteRelations` and `scopeResolver`; other files create their own scratch data.
Missing fixture notes are environment failures, not permission to regenerate a baseline from
an empty result. Check a file's setup before selecting its vault.

`scripts/generate-vault.mjs` writes a realistic vault: the `groups` relation graph,
journals, tasks, finance accounts/transactions/categories, time entries and `.abchat` files.
Output is deterministic for a given `--seed`.

```bash
node scripts/generate-vault.mjs --out /path/to/scale-test-vault --files 12000 --seed 42
```

Options: `--out` (required), `--files` (approximate total, default 12000), `--seed`
(default 42), `--force` (write into a non-empty directory).

The group graph includes one deliberately wide "mega group" whose transitive closure covers
a large share of the vault. The old rescan cost (closure size) × (notes carrying a `groups`
property), which made a wide closure over a link-dense vault block the main thread. The
operation-count checks guard against reintroducing that shape; historical wall times are
not thresholds for the current implementation.

Link density matters as much as file count. Journals, tasks and transactions all link into
the general note population — which is itself group-attached — because backlink lookups and
relation walks scale with how many notes point at a group's members. A sparsely linked
vault hides that cost completely: an earlier version of this generator averaged 0 body links
per finance note and 1 per task, and `NoteRelations` looked fast. At realistic density
(~2 links per finance note, ~3 per task, ~9 per journal, ~6 per note) the same code took
seconds on a single group note — a quadratic backlink lookup that only a densely linked
vault made visible at all.
