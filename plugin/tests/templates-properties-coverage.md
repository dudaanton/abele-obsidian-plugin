# Templates, note headers, criteria and properties: characterization map

This change adds **151 fast tests in 14 test files**, including **9 expected failures** documenting existing bugs. A shared vault harness supplies workspace/command adapters without replacing the template/entity implementations. No production source or existing tests were changed.

The table is a behavioral coverage inventory, **not a claim of 100% instrumented branch coverage**. `@vitest/coverage-v8` was unavailable and was not installed. **New** means exercised by this batch; **existing** means exercised by the already committed fast tests, rerun with the batch. UI layout and real host behavior still have the limits below.

## Function and branch inventory

Paths in the test column are relative to `tests/`; `C` below abbreviates `Characterization.test.ts`.

| Source / functions | Behavior exercised | Tests / status |
| --- | --- | --- |
| `TemplateParser.parseTemplateVariables` and expression/default helpers | Every field type; dates/offsets/formats; plugin syntax; select options; escaped defaults; raw-expression deduplication; unknown suffixes; incomplete input; repeated calls; 10,000 occurrences | `unit/templateParserC` — new |
| `TemplateParser.applyTemplateVariables` and resolver helpers | Literal global substitution; all field kinds; missing input; leap-day/local-time offsets; quoted YAML lists; empty/nonarray/invalid JSON; plugin receiver, async results, unavailable registry/plugin/method, thrown errors | `unit/templateParserC` — new |
| `UserTemplate` constructor, `displayPath`, `dirSegments`, `isDefault`, callback and target-property extraction | Defaults; zero order; nested/empty directory segments; command filtering; undefined/reserved keys; arrays/quotes/empty arrays | `integration/userTemplatesC` — new |
| `UserTemplate.fromFile`, `getContent`, `getBody`, metadata stripping | Cache validation; disk reads; ordinary/nested properties and comments; removed metadata continuation lines; converted target type; default type omission; empty frontmatter removal; body spacing | `integration/userTemplatesC` — new; arbitrary quoted/hyphenated YAML keys and CRLF stripping are not exhaustively covered |
| `TemplateService.getInstance`, `discoverTemplates`, type/default filters, sorting | Stable ordered ties; negative/zero order; alphabetical unordered names; missing/default templates; cached rather than body metadata; rediscovery after metadata edits, moves, renames and deletion | `integration/userTemplatesC` — new |
| `TemplateService.buildTemplateHierarchy` | Root entries; repeated nested nodes; encounter order; empty path segments | `integration/userTemplatesC` — new |
| `TemplateService.createNoteFromTemplate`, path/folder/target-property helpers | Body/path/property-only variables; newFileLocation root/current/folder; missing active file/config; nested folder creation; collision suffix `(1)`; arrays, wikilinks, colon and whitespace escaping; duplicate-key defect | `integration/userTemplatesC` — new |
| `TemplateService.replaceNoteWithTemplate`, `insertTemplateAtCursor`, callbacks | Replacement does not rename; insert excludes target properties and writes no file; callbacks see saved content, run in order, and continue after errors | `integration/userTemplatesC` — new |
| `TemplateService.applyDefaultTemplate` | Missing default; input-required body; date-only default on empty note; input-required target-property defect | `integration/userTemplatesC` — new |
| Default-note hook through public `AbelePlugin.onload` | Layout-ready registration; fake-clock grace period; folders/nonmarkdown/exclusions/journals/nonempty notes; whitespace-only input; unsaved editor content; a writer during the grace period; a writer during template reading | `integration/defaultTemplateHookC` — new; unrelated startup subsystems deliberately omitted |
| `useTemplates`: every exported flow, selection, confirmation, close/reset; `getTemplateComposable` | Variables from body/folder/name/properties; target deduplication; selection auto-fill; no-input auto-apply; create/open, replace, insert; disappearing active target; error reset; exact/extensionless path; missing template; singleton identity | `integration/templateFlowC` — new |
| `TemplateVariablesModal` | Defaults before external input; empty overrides; select/wikilink/scalar/list editing; wiki rows; malformed JSON; confirm/cancel; image preview/clear; vault choice/cancel; disk choice/cancel; clipboard success/empty/denied | `component/templateVariablesC` — new; real input components, shell and external pickers/importers are adapters |
| `GenericTemplate.getFullPath`, `createNoteWithTemplate`, protected file/path helpers | Sanitized name consistency; default folder; existing-file reuse; overwrite; focus false; active leaf vs openLinkText; write-failure notice | `integration/builtinTemplatesC` — new |
| `TaskNoteTemplate.createTemplate` and path behavior | Explicit null/removal versus omitted values; old properties; dates/times; empty body; spacing and entity writes | `unit/taskDatesAndMarkup.test.ts`, `unit/frontmatterSeparator.test.ts`, task integration tests — existing |
| `TimeEntryNoteTemplate.getFullPath`, `createTemplate` and label/path helpers | Local start/end; default clock; groups/aliases; Timer fallback; explicit root/folder/name; configured path | `integration/builtinTemplatesC` — new |
| `TransactionNoteTemplate.getFullPath`, `createNoteWithTemplate`, `createTemplate`, frontmatter merge helper | Zero amounts; nulls; old properties; default date/currency; configured UserTemplate; caller currency override; body variables; explicit content bypass; consumed rendering; stale rendering after existing-file early return | `integration/builtinTemplatesC` — new, supplemented by existing finance entity tests |
| Compatible `js-yaml` note reader through `parseNoteContent` | Unquoted Date vs quoted string; only top-level Date normalization; local midnight/nonmidnight; nested/list Dates; YAML 1.1 octal vs direct js-yaml; booleans, null/empty strings; comments; quoted/unquoted wikilinks; nested/flow/block YAML; literal/folded scalars; anchors/merges; duplicate/malformed YAML errors | `integration/frontmatterC` — new |
| `getNoteBody`, `getNoteRawFrontmatter`, `replaceNoteBody`, parser fence/body handling | LF/CRLF and blank lines; raw comments; missing/empty fences; BOM and `...` package fences vs regex extraction; sequence frontmatter; reserved `content` collision | `integration/frontmatterC` — new; `unit/frontmatterSeparator.test.ts` — existing |
| `getFrontmatterFromCache`, `getNoteData`, `updateNoteFrontmatter` | Cache object identity vs disk vs unsaved editor; missing files; shallow merge; created defaults; name omission and rename; timestamp/spacing loss defects | `integration/frontmatterC` — new; host serializer replaced locally with js-yaml and its input object asserted |
| Legacy `renderTemplate`, `createNoteFromTemplate` | Named/date fields; unsupported newer syntax; missing values/template; Untitled; directory creation; existing-note reuse/open | `integration/frontmatterC` — new |
| `Header` constructor, `load`, `initWatcher`, journal/metadata helpers, `cleanHeaderData`, `cleanup` | Path normalization; cache not editor; once/force loading; empty metadata; missing file; rename/move and rekey; first matching journal; metadata retelling; cleaned-up late events; one registration; idempotent cleanup; removed-frontmatter defect | `integration/headerC` — new; `integration/headerJournalAtStartup.test.ts`, `unit/headerListeners.test.ts` — existing startup/strict raw-handle regressions |
| `Criterion` constructor, `checkRegExp`, `checkPathCriterion`, `checkPropertyCriterion`, `checkContentCriterion`, `isValid` | Every operator; supported-surface differences; case folding; array membership vs substring; null/undefined/false/zero coercion; plain/slash regex, flags, invalid regex and repeated calls; validation/whitespace | `unit/criteriaAndReplacementC` — new |
| `ReplacementAction` constructor, `applyPathReplacement`, `convertValueToArrayIfNeeded`, `applyPropertyReplacement` | Moves; semicolon splitting; scalar replacement; null properties; copy semantics; exact-case deduplication; remove/replace lists; empty items; irrelevant action no-op | `unit/criteriaAndReplacementC` — new |
| `ReplacementAction.applyContentReplacement`, `applyPropertyContentReplacement`, `isValid` | Literal/global/regex replacements; captures/flags; invalid patterns; deletion; guarded no-ops; mixed-type arrays and untouched fields; required fields for every action | `unit/criteriaAndReplacementC` — new |
| `Gallery` constructor, `filePath`, `resolveImageUrl`, `cleanup` | TFile rename/move; remote/local/missing links; readonly/source-only/detached mounts; generated vs explicit id | `integration/galleryEditingC` — new; `unit/vaultUrl.test.ts` — existing cache-busting |
| `Gallery.addImage`, `addImages`, block matching | Current editor, skipped blanks, later matching block, stale identity no-op, missing editor, empty block/list, identical-block first match | `integration/galleryEditingC` — new |
| `Gallery.removeImage`, `updateDescription`, `moveImage` | Actual image line numbers; local/remote captions; swapping across blanks; invalid indices/boundaries; stale block and absent editor | `integration/galleryEditingC` — new |
| `Gallery.setLayout`, `setHeight`, `setBg`, header helpers, `removeHeaderOnly`, `removeBlock` | Default-option elision; nondefault combination; entity snapshot options; header-only removal; empty and start/end blocks; middle-block text-joining defect | `integration/galleryEditingC` — new |
| `properties/values`: `linkTarget`, `isWikilink`, `fileEntries`, `withEntry`, `withoutEntry`, `fileKind`, `isCoverKey` | Link/path/alias/heading handling; lists; duplicate file targets; file kinds and cover names | `unit/propertyValues.test.ts` — existing |
| `properties/counter`: `counterValue`, `stepCounter`, `counterKeys`, `isCounterKey` | Empty/numeric/text/error coercion; stepping; name lists | `unit/propertyCounter.test.ts`, `component/propertyWidgets.test.ts` — existing |
| `properties/dates`: every exported function | Invalid shapes/days/hours/minutes; leap/month/year/DST edges; local/zone arithmetic; seconds/fractions; picker replacement; relative units; empty input; invalid-second defect | `unit/propertyEdgesC` — new; `unit/propertyKinds.test.ts` — existing |
| `properties/priority`: `priorityLevel`, `priorityAt`, `stepPriority`, `priorityName` | Empty/scalar/list values; normalization; bounds/clamping/no-op; names | `unit/propertyEdgesC` — new; `unit/propertyKinds.test.ts` — existing |
| `properties/labels`: `labelsOf`, `isLabelsValue`, `addLabel`, `removeLabel`, `suggestLabels`, `collectLabels` | Link retention; case/hash normalization; empty/invalid inputs; per-note deduplication; ordering/counts; held/query filtering | `unit/propertyEdgesC` — new; `unit/propertyKinds.test.ts` — existing |
| `properties/groups`: exported parsing/add/collect/suggest functions; `GroupPicker` and `renderGroups` | Existing group link/picker/stock-editor behavior | `unit/propertyGroups.test.ts`, `component/propertyGroups.test.ts` — existing; no changes to parallel groups work |
| `properties/kinds.pickKind` | Every kind, host type constraints, configured names, invalid first-listed kind does not fall through, live list reads | `unit/propertyEdgesC` — new |
| `renderCounter`, `renderDate`, `iconButton`, `renderPriority`, `renderLabels` | DOM events, invalid/empty values, external setValue, date time/sibling fields, labels suggestions/colors and priority controls | `component/propertyWidgets.test.ts`, `component/propertyKinds.test.ts` — existing; no layout claim |
| `properties/dailyNote.openDailyNote` | Configured journal preference; existing/new note; template; core plugin fallback/options; missing/disabled provider; leaf forwarding on existing and core notes | `integration/propertyDailyNoteC` — new |
| `properties/types.assignFileType`, `assignFileKeys` | Existing/custom assigned types; unavailable widget; once-only default keys; assignment on layout-ready | `unit/propertyTypes.test.ts` — existing; `component/propertyRegistrationC` — new indirectly; synchronous/asynchronous manager failure branches not newly covered |
| `properties/widgets.typeRegistry`, `PropertyWidgets.load/apply/active/destroy`, `redrawProperties` | Registry absence; restore originals; Files ownership; number calculations; file cards; wallet redraws; visible-key deduplication | `component/propertyWidgets.test.ts` — existing; `component/propertyRegistrationC` — new |
| `registerPropertyWidgets` | Initial on/off; layout-ready assignment; version changes; list changes on/off; unchanged settings; cleanup stops watcher; missing registry | `component/propertyRegistrationC` — new |
| `thumbnailOf`, EPUB/PDF helpers, `forgetThumbnails` | Live image/note-cover URLs; unsupported types; size guard; shared pending/version cache; cached failure; invalid ZIP/nonimage/no cover; URL revocation; missing PDF library; page width/security options; document cleanup on success/error | `unit/propertyThumbnailsC` — new; EPUB/PDF/canvas dependencies are adapters, not real decoding |
| `properties/wallet.holdsBalance`, `walletBalance` | Asset/liability eligibility, links/source paths, historical date and totals | `unit/propertyWallet.test.ts`, `unit/propertyWalletCharacterization.test.ts` — existing finance coverage |

## Historical regressions pinned

- `b51dda70`: independent parser regex state — repeated parsing and target/body parsing.
- `e2a0d2a4`, `a8fe8c00`: variables occurring only in folder/name/target properties — service and composable tests.
- `a94bdc4d`, `a43ca7e4`: quoted wiki lists and array-valued target properties — parsed output assertions.
- `c54eef4d`, `638f575d`: transaction UserTemplate and caller currency — built-in template tests.
- `c66520f1`, `5a369979`: linkable sanitized filenames — GenericTemplate tests.
- `0f26ff30`, `72037173`, `fe53611e`: datetime parsing, exact body spacing, parent creation — frontmatter/legacy helper tests. The separate writer still has the first two defects documented below.
- `a1602d6d`: Gallery keeps a live TFile rather than a stale path — rename test.
- `0447cc79`, `49168ad8`: header startup metadata and reactive event-handle cleanup — existing tests rerun, with new lifecycle coverage.
- Existing property widget, group, wallet and resource-URL tests retain the stock-editor, late finance-index, source-note switching, default file types and cache-busting regressions. Narrow-screen wrapping/width fixes remain in their existing e2e tests, not inferred from happy-dom.

The earliest tracked `notesUtils.ts` already imports `front-matter`; its original selection rationale is not recorded there. Tests therefore preserve observed legacy-package semantics rather than guessing why it was chosen. The compatible `js-yaml` reader now retains those semantics without the legacy dependency; `unit/noteFrontmatter.test.ts` was captured against `front-matter` before the swap.

## Bugs retained as expected failures

All have a `BUG:` comment and a desired-behavior assertion. None is fixed here.

| Bug | Cause / reproduction | Test |
| --- | --- | --- |
| Default property silently loses required input | `applyDefaultTemplate` inspects only body user variables; put `{{Topic}}` solely in `template_for_topic` | `userTemplatesC`: refuses input-required target property |
| Duplicate frontmatter keys | `applyTargetProperties` appends instead of merging; define `labels` in body and `template_for_labels` in metadata; resulting YAML reader throws | `userTemplatesC`: override without duplicate keys |
| Default-template concurrent data loss | Empty check precedes an awaited template read; another writer fills the note during that read; final modify overwrites it | `defaultTemplateHookC`: controlled read barrier |
| Stale transaction body | `_renderedTemplate` survives GenericTemplate's existing-file early return; reuse the template instance for a new note with explicit content | `builtinTemplatesC`: prepared-template reuse |
| Frontmatter writer drops time | `updateNoteFrontmatter` converts all top-level Dates to date-only strings, unlike `parseNoteContent`; edit an unrelated property beside an unquoted timestamp | `frontmatterC`: preserves datetime |
| Frontmatter writer drops body blank lines | It uses stripped `front-matter.body` then inserts one blank line; update a note with three leading blank body lines | `frontmatterC`: preserves body spacing |
| Header retains removed properties | Forced load resets fields only when frontmatter exists; remove the whole YAML fence from a loaded note | `headerC`: clears removed frontmatter |
| Gallery deletion joins surrounding text | `removeBlock` consumes both neighboring newlines; delete a block between `Before` and `After` | `galleryEditingC`: preserves text separator |
| Invalid seconds accepted | `parseDateValue` validates hour/minute but not seconds; pass `2028-03-01T12:00:99` | `propertyEdgesC`: rejects invalid seconds |

The already documented western-time-zone unquoted-calendar-date shift remains present. This batch additionally pins the exact shifted top-level string versus untouched nested Date representation; `integration/taskHeaderEditing.test.ts` already has the desired-behavior expected failure.

## Intent questions and limits

- Regex syntax/case behavior differs by criterion surface: content interprets bare regex and honors `caseInsensitive`; path/property accept slash flags and ignore that setting for regex. Pinned, not unified.
- Defaults are input-dialog metadata, not parser fallbacks. Insert does not apply target properties; a direct default-service call is not itself an empty-note guard. Pinned at each layer.
- Galleries identify blocks by raw image sequence: identical blocks select the first, empty `addImages` inserts a newline, and successive header edits use the entity's original option snapshot. These behaviors are pinned, not redesigned.
- A time-entry path with missing start/end leaves a space before `.md`; current safe-path behavior collapses but does not remove that space. Pinned rather than treating a legal filename as a bug.
- Cache values are supplied explicitly by the existing fake; no claim is made that its YAML coercion equals Obsidian's. The compatible note reader and direct `js-yaml` run unmocked. The frontmatter writer's host serializer is locally adapted, and its object argument is asserted; host quoting/formatting remains unverified.
- Header deletion/unmount timing, all unusual frontmatter key/fence variants, template read/write rejection combinations, widget DOM sweeping, thumbnail completion after unload, and every image-import error branch are not exhaustively characterized. No 100% branch-coverage claim.
- Standalone GenericTemplate-first import exposes an existing store/entity import cycle in the test runtime. Built-in tests initialize the store module first, matching the normal startup dependency graph; no source change was made.
- No live Obsidian or phone session was used: no product UI changed. Existing reading-view/gallery/metadata-cache/phone-layout e2e files were not rerun. Fast gallery readonly/postprocessor and header metadata tests were rerun.

## Verification

- `npm ci`: completed in this worktree; no dependency changes. It reported 21 dependency advisories (11 moderate, 10 high), outside this tests-only task.
- Full fast tier: **542 files, 6,871 tests passed**, including the intentional expected failures. New tests use fixed clocks/non-UTC timezone, fake timers and controlled promises rather than sleeps.
- `npm run types`: passed (the repository's production TypeScript gate).
- `npm run lint`: passed with **0 errors / 859 pre-existing warnings**; no diagnostics in the new test files.
- `git diff --check`: passed. Repository pre-commit guards and the available staged anonymity check passed; fixtures were also reviewed manually.
