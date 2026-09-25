# Testing

Three tiers, each with its own command. All commands run from `plugin/`.

| Command | Tier | Needs Obsidian | Runs on commit | Runs in CI |
|---|---|---|---|---|
| `npm test` | unit + integration + component | no | yes | yes |
| `npm run test:size` | bundle size | no | no | yes |
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

## Bundle size — `tests/size/`

`npm run test:size` builds the production bundle in memory (about 6 s, nothing is written to
`build/`) and fails when `main.js` or the stylesheet is over its budget in
`tests/size/budget.json`. Obsidian reads and compiles the whole of `main.js` on every start,
phones included, so every byte is paid for at load whether the feature behind it is used or
not. Raising the budget is a decision, made in the same diff as whatever needed the room.

The run also says where the bytes go — the heaviest packages in the console, all of them in
`/tmp/abele-bundle-size.json`. `node scripts/bundle-size.mjs` prints the same table without
the test. The split counts each module as Rollup rendered it, before minification, scaled to
the minified total: right about which package is heavy, not to the kilobyte.

The build runs in a process of its own. Built inside Vitest, whose environment leaks into Vite
and the Vue plugin, the same bundle came out 10–130 KB larger than the one `npm run build`
ships.

A dynamic `import()` does not make a dependency cheaper here: `inlineDynamicImports` keeps it in
`main.js` (see *The test hook* below), so its bytes are still read and compiled at every start —
only its top-level code waits until first use.

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
  A third writes the keyboard's height as Obsidian's iPhone app does. Where the page shrinks the
  dialog has to fit the smaller page and scroll inside; where the keyboard is drawn over the page
  it keeps its size, and what the keyboard covers scrolls up above it — the time field in sight,
  the buttons reachable. Writes one task note for the run and removes it; pictures go to
  `/tmp/abele-phone/task-date-*.png`.

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
  page is kept; page size and dark pages follow the settings; the setting that opens PDFs here
  takes `.pdf` from Obsidian's viewer and gives it back, and the file menu offers **Open in Abele
  reader**. A hostile PDF — JavaScript on opening, behind a link, in a form field and in the names
  tree, a `javascript:` and a `file:` address, a launch action — is opened with both sandboxes and
  every link on it clicked: nothing may run, open, alert or ask for `child_process`. The phone file
  opens a PDF too, and checks the page fits the screen and turns by a tap and a swipe.
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
- `bookFormats.e2e.test.ts` — **the other formats**, with files written byte by byte in
  `tests/fixtures/books/otherFormats.ts` and `richBook.ts`: a Mobipocket book, a FictionBook bare
  and zipped, a comic archive and a fixed-layout EPUB, each carrying scripts, handlers or runnable
  links. Each opens from its file, every part is visited and every element clicked, with the
  desktop's sandbox and the iPhone's: its text shows, no script is in any page, nothing runs or
  opens. The comic's pages come in numeric order; a Kindle book whose header says it is encrypted
  says it is protected by DRM; words on a fixed page are highlighted with boxes; `book_read` and
  `book_search` read the Mobipocket and FictionBook files.
- `bookSelecting.e2e.test.ts` — **selecting on pages turned one at a time**: with the mouse on the
  desktop, then under `emulateMobile` at 390×844 with touches sent through the app's own input
  pipeline (`Input.dispatchTouchEvent`, from inside the app so a long press lasts as long as it
  says). Only a clean tap at an edge or a swipe turns the page; a long press, a finger held and
  moved, a swipe or tap over a selection, a tap on a highlight, a tap beside an open bar and taps
  on the bars' buttons do not. A selection held at the edge turns the page and grows onto the
  next — with the mouse, with a finger, and with only its end moved, as iOS's handles do — and is
  highlighted as one. With nothing but the selection to go by, as under iOS's handles, it never turns
  by itself, stays on its page when WebKit runs it to the end of the chapter, and the buttons beside
  the page carry it on and back. It stops at the end of the chapter and in a PDF at its page, and
  says so.
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
  below a page's text selects to the end of the chapter.
- `bookPhoneControls.e2e.test.ts` — **the reader's controls on a phone**: the progress slider
  dragged does not open the side panel; the text and layout dialog scrolls to its last row and the
  note and comment dialogs show their buttons; a dialog with a search field keeps its size under a
  keyboard mimicked as Obsidian's iPhone app reports it, and its list scrolls up above it; with
  `tests/fixtures/books/figureBook.ts`, a lone picture is centred, a small one left alone, a wide
  table scrolls sideways without turning the page, a tap opens either full screen (pinch, fit,
  swipe down), and turning the phone keeps the place. Pictures in `/tmp/abele-phone/controls-*`.
- `bookPlaces.e2e.test.ts` — **where a book was left, across a restart**: a book and a PDF read to
  a place, the window reloaded with their tabs open, the restored tabs open where they were and
  the file of places still holds them.
- `bookSpeech.e2e.test.ts` — **reading aloud**, with the platform's speech swapped for a stand-in
  (`window.__abeleTest.reader.hooks.speech`) that records each sentence and ends it a moment later,
  so nothing is heard. With the rich book and the plain PDF: the header's button reads from the
  page on screen, the sentence marked, and goes on into the next chapter; pause, go on, skip and
  back do what they say; closing the tab stops it; **Read aloud from here** starts at the selected
  words in the chosen voice and speed; a PDF is read a page at a time with a box over the sentence,
  turning to the next page. Last, it checks the app has platform voices, English among them.
- `bookReading.e2e.test.ts` — **reading**, on the desktop, with the book of
  `tests/fixtures/books/richBook.ts`: a note marked as one and a note marked only by a superscript
  open in the dialog; a link to another chapter is followed and the way back works; the contents
  sit beside the page and go to a chapter; the place is kept across closing the tab and across
  renaming and moving the file; a change of the text and layout settings and a switch to a dark
  theme redraw the open page. Puts the settings and the theme back after itself.

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
