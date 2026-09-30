# Finance characterization coverage

Tests only, based on the implementation and its history at `aba15938`. No production
code, dependencies or existing assertions were changed. The worktree had no `CLAUDE.md`
(the first read returned ENOENT), so the supplied coverage brief was used.

## Measurement and verification

- 140 new cases in 10 test files: 132 ordinary passing cases and 8 `it.fails` cases
  representing five defects. Each defect was first run as an ordinary failing test,
  then marked `it.fails`; none was fixed.
- Full fast suite: **511 files / 6424 tests passed**, including expected failures.
- `npm run types`: passed (the repository's configured source type check).
- `npm run lint`: passed, **0 errors / 859 warnings**; no warnings in changed test files.
  An initial lint invocation hit the command timeout; rerunning with a longer timeout
  completed successfully.
- `git diff --check`: passed.
- `@vitest/coverage-v8` is not installed. It was not added. The table below is a manual
  function/branch inventory, **not** a claim of measured 100% line/branch coverage.
- Fixed dates in Europe/Moscow reproduce a local first-of-month while UTC is still in
  the previous month. Series tests also cross leap day, a Sunday/Monday DST transition
  in Europe/Berlin, and New Year. Timed subscriptions use fake timers, not sleeps.
- No live Obsidian, test vault, phone, e2e, build or release was used. There was no shared
  resource lock protocol in this brief; the existing e2e tests were read, not run.

## Function and branch inventory

Paths below are relative to `plugin/tests`. Existing tests remain unchanged.

| Production surface                                                                                      | Behaviour covered                                                                                                                                                                                                                                                                                                    | Tests                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `walletAmount`                                                                                          | Both roles; no wallet currency; matching foreign currency on either side; explicit foreign zero; matching primary currency; missing conversion; conversion without a currency; unrelated foreign currency; missing primary currency; same-currency/unknown other wallet; negative amounts                            | `unit/walletAmount.test.ts` (13 table rows), existing `unit/balanceIndex.test.ts`                                                               |
| `Transaction` constructor, path/folder/name getters, date helpers, `toCreateDTO`                        | Aliases and resolved paths; supplied ID/fields/zero; normalized source path; dated/undated matching; DTO group copy and oldProps sharing                                                                                                                                                                             | `integration/financeEntities.test.ts`                                                                                                           |
| `Transaction.load`, `loadContent`, `initWatcher`                                                        | Lazy body reads; numeric strings/null/empty/invalid numbers; invalid date; array/scalar groups; unknown property preservation; first nonblank title and description; empty/missing note/cache; loaded/force guards; idempotent watcher; modify/rename                                                                | `integration/financeEntities.test.ts`                                                                                                           |
| `Transaction.writeTransactionToFile`, `remove`, `cleanup`                                               | Template delegation with default/explicit flags; file-manager trash rather than permanent delete; already absent file; repeated cleanup, field reset, no reloading after cleanup                                                                                                                                     | `integration/financeEntities.test.ts`                                                                                                           |
| `Account` constructor/getters, `load`, `loadContent`, `initWatcher`, `cleanup`                          | Aliases; balances/dates/types/currencies; computed sources; array/scalar variants; exclusion truthiness; forced reload; missing/empty body fallback; watcher updates/moves; terminal cleanup/reset                                                                                                                   | `integration/financeEntities.test.ts`                                                                                                           |
| `AccountsList` / entity `TransactionsList`: discovery/add/remove/type checks/rename/event queue/cleanup | Exact type and Markdown scan; late initial cache; first-resolve rescan only once; deferred additions/deletions/renames; duplicate changed events; missing files/folders; untracked events; new entity on move; repeated cleanup and unregister requests; type removal and rename/cleanup defects                     | `integration/financeLists.test.ts`                                                                                                              |
| `AccountsList.getAccountByWikilink`                                                                     | Full path, aliased basename, missing target and non-account target                                                                                                                                                                                                                                                   | `integration/financeLists.test.ts`                                                                                                              |
| `BalanceIndex.rebuild`, link cache, entry creation, currency selection and prefix sums                  | Empty vault; unloaded/undated/null-amount skip; zero/refund/self-transfer; missing sides and unresolved links; clear/replace on rebuild; folder-local account/category resolution; negative-cache reset; opening cutoff; categories with misleading currency properties; 2000 exact-cent amounts                     | `unit/balanceIndexCharacterization.test.ts`, existing `unit/balanceIndex.test.ts`, `unit/moneySum.test.ts`                                      |
| `BalanceIndex.getBalanceAtDate`, `getBalanceSeries`                                                     | Before/on/after opening date and first/last entry; unordered dates and same-day entries; empty/one-day/reversed range; leap month, DST/week and year boundaries; exact arithmetic                                                                                                                                    | `unit/balanceIndexCharacterization.test.ts`                                                                                                     |
| `BalanceIndex.getCurrenciesForAccount`, `getBalanceAtDateByCurrency`, `getBalanceSeriesByCurrency`      | Sorted separate category currencies; absent currency; before-first entry; missing currency goes to unkeyed balance; inclusive zero-filled series and reversed range                                                                                                                                                  | `unit/balanceIndexCharacterization.test.ts`                                                                                                     |
| `BalanceIndex.getNetWorthAtDate`, `getNetWorthAtDateByCurrency`                                         | Signed positive/negative liabilities; excluded assets/debts; categories/computed accounts ignored; currency filtering; aggregate currently sums currencies without conversion                                                                                                                                        | `unit/balanceIndexCharacterization.test.ts`                                                                                                     |
| `BalanceIndex.getTotalForPeriod`                                                                        | Inclusive/reversed dates; missing/date-less/unloaded entries; category with/without match; account directions and signed net; self-transfer; no account filter; primary amounts rather than foreign conversion                                                                                                       | `unit/balanceIndexCharacterization.test.ts`                                                                                                     |
| `BalanceIndex` subscriptions and `cleanup`                                                              | First resolve only; relevant metadata only; deferred burst after entity reload; tracked account/transaction deletion; unrelated files/folders ignored; cache clear and unregister; pending rebuild cleanup defect                                                                                                    | `unit/balanceIndexCharacterization.test.ts`, `integration/financeIndexEvents.test.ts`                                                           |
| `buildLedger`                                                                                           | Loaded/dated selection (null amounts retained); descending date then ctime; stable ties; live entity identity; no input reordering; memoized hits/misses; empty input; 2000 transactions                                                                                                                             | `unit/financeLedger.test.ts`                                                                                                                    |
| `useFinanceLedger`                                                                                      | Every tracked field; initial missing list, replacement and clearing; added/removed entities retracked; custom trailing settle interval; hidden work suppression; immediate reactivation; cancellation on hide/dispose; ctime fallback; body-only updates; duplicate-name resolution defect                           | `unit/financeLedger.test.ts`, existing `component/financeSidebarWork.test.ts`                                                                   |
| Wallet property `holdsBalance`, `walletBalance`                                                         | All account types; non-link inputs, missing targets/non-accounts; alias stripping and source-note forwarding; local today/explicit date; optional currency; rounded negative-zero tint and positive liability                                                                                                        | `unit/propertyWalletCharacterization.test.ts`, existing `unit/propertyWallet.test.ts`                                                           |
| `FinanceSidebar` period summaries and currency cards                                                    | Primary note amounts rather than category balance cutoffs; savings; lent/returned directions; currency tab ordering/switching; month and inclusive custom ranges; end-date balance cards; older recent rows retained; future rows excluded; empty period                                                             | `component/financePeriods.test.ts`, existing `component/financeSidebarDebts.test.ts`, `unit/financeTotals.test.ts`                              |
| `FinanceSidebar` pie/calendar/net-worth chart functions                                                 | Pie amounts and slice navigation; theme disposal/recreation; calendar empty days and tooltip labels; local-month length; custom range calendar hiding; signed per-currency net-worth series; legend selection survives rebuild; index version reactivity                                                             | `component/financePeriods.test.ts`                                                                                                              |
| Footer `TransactionsList` sorting/type/day totals and add action                                        | Expense/income/transfer classification; per-date grouping; asset-transfer exclusion; negative signs currently used for both liability directions; full-day sum past first page; contextual from/to/date creation; empty list                                                                                         | `component/financePeriods.test.ts`; existing `component/transactionSearch.test.ts`, `component/footerFolds.test.ts` cover paging/search/folding |
| `TransactionItem` mount/visibility/toggle/type/click/context menu                                       | Metadata on mount; content on first visibility only; link source paths; description expansion/collapse; amount classes; nullable amount; card versus nested link/icon click; confirm/cancel deletion; missing-note placeholder                                                                                       | `component/transactionItem.test.ts`                                                                                                             |
| `AccountBalanceChart` data/render/period/theme/unmount                                                  | Asset line, category per-currency daily bars, positive revenue activity, computed signed sources/unresolved sources, duplicate/nonrecursive computed sources, initial and changed period events, empty/missing/reversed states, index reactivity, theme recreation, disposal, overlap options, tooltip negative zero | `component/accountBalanceChart.test.ts`                                                                                                         |
| `AccountsSidebar` and account row helpers                                                               | Existing coverage retained: type grouping, absolute/signed/name sorting, positive/negative debts, zero/excluded/currency filters, computed source sums, note opening, persisted options, hidden-state work                                                                                                           | Existing `component/accountsSidebar.test.ts`, `unit/accountRows.test.ts`                                                                        |

## Defects intentionally left failing

1. **Changing `type` does not remove financial entities** — `AccountsList` and
   `TransactionsList` only attempt additions in their changed/resolved queues. Change a
   tracked note to `type: note`: it remains in finance until restart. Two expected-failure
   cases in `integration/financeLists.test.ts`.
2. **Cleanup can leak a renamed list entry** — entity watchers update the entity path
   before the metadata-resolved queue rekeys the list map. Cleanup removes using the new
   entity path, leaving the old-key entry and watcher. Reproduce by letting rename reach
   the entity, then cleaning the list before `resolved`. Two cases in the same file.
   The shared synchronous debounce mock represents the entity callback having settled;
   the ordering, not a particular real-app delay, is what is asserted.
3. **The screen ledger resolves duplicate account names from the wrong origin** —
   `useFinanceLedger` resolves from `''` and `buildLedger` memoizes only the wikilink.
   `[[Wallet]]` in Home and Work transactions becomes null (or the root wallet), unlike
   `BalanceIndex`'s source-folder resolution. Screen classification/day/period sums can
   disagree with balances. One case in `unit/financeLedger.test.ts`.
4. **Standalone entities miss vault deletion** — `VaultWatcherWrapper` sends delete
   without `event.file`; `FileWatcher` requires a `TFile` and never forwards it. An
   account header or transaction entity outside list cleanup retains its old state
   instead of becoming not-found. Two cases in `integration/financeEntities.test.ts`.
5. **Disposed balance index still rebuilds** — `BalanceIndex.cleanup` does not cancel
   its pending debounced rebuild or guard against executing after cleanup. Schedule an
   edit, clean up, advance the timer: version increments again. One case in
   `integration/financeIndexEvents.test.ts`, using a file-local deferred debounce double.

## History traced

- `23357f69`, `2ef41e7e`, `8ac23eac`, `64e30464`: outgoing foreign amount,
  currency-less categories, absent conversion, source-relative wallet resolution.
- `4a682abf`, `a43ca7e4`, `7f4cfcd3`, `ae62ddb9`: signed liabilities, lent/returned,
  positive-debt-only cards, both debt directions on one row.
- `762fe8fc`, `7d0e427e`: exact decimal accumulation and display without negative zero.
- `c7255129`, `3e10a9da`, `f7db1c2e`: note-based period totals, transfer exclusion,
  chart-period events.
- `587d35fb`, `399e2db`, `43d11566`, `97e03dff`: reactive chart updates, navigation,
  theme recreation, overlap options, safe sidebar initialization.
- `2ba2262e`, copied-list ancestor `dca786e8`: trash preference and unregistering
  metadata listeners.
- `1db765de`: ledger batching and hidden-screen work. Existing first-of-month regression
  tests (`2ddecee7`) also continue to pass.
- `7e5b76e2`: footer search keeps the drawn pages, restores them on close, and does not
  persist search-only pagination; covered in `component/financePeriods.test.ts`. Pure CSS fixes `0ee3124c` and
  `a9d5d7ca` already have live e2e geometry assertions (`transactionRow.e2e.test.ts`,
  `financeSidebarLayout.e2e.test.ts`); these were not rerun here.

## Questions pinned, not silently redesigned

- `getTotalForPeriod` uses primary amounts, even when querying the foreign wallet;
  the all-currency net-worth API simply adds different currencies.
- Both lent and returned transactions subtract from date-heading totals, although the
  period summary distinguishes the two directions. Only asset-to-asset transfers vanish
  from date totals.
- Missing-currency category amounts go to the unkeyed balance, not a currency bucket.
- Duplicate computed source links count twice; computed sources are not recursively
  expanded. Missing computed sources are ignored.
- Numeric frontmatter uses `Number`: empty strings become zero and invalid strings
  become `NaN` on transactions. String `excludeFromTotal: 'false'` is truthy. These are
  characterized as coercion policy, not endorsed as a desirable validation contract.
- `writeTransactionToFile` delegation is tested, not promise completion: history explicitly
  reverted awaiting the template in `67c34a77`. Actual template persistence/concurrent
  file writes are outside these tests.

## Limits and test seams

No production seam was added or needed. Public entities, fake vault events, Vue effect
scopes, component props/events/DOM and ECharts call arguments expose the core behaviours.
The only shared helper change adds the real observer entry's `time` field to the existing
IntersectionObserver double; without it VueUse ignores a visibility event. The new row
visibility tests failed before that test-double correction.

The fake vault does not unregister handlers or automatically rewrite backlinks on rename.
Tests assert unregister requests and explicitly drive metadata events; they do not claim to
prove Obsidian's cache timing or automatic link rewrite. Deferred index tests model debounce
locally, while all actual-app timing remains unverified. Canvas rendering, reading-view
property placement, real mobile layout and resize-observer resource accounting are not
measured. Private defensive branches unreachable through valid public inputs, arbitrary
malformed non-string link values, and every possible concurrent write interleaving are not
exhaustively covered. No assertion of complete module branch coverage is made.
