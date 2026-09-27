# Analytics

Statistics over the vault for agents and scripts: read a source into a table, run an analysis
spec on it, answer with JSON (and an `abele-chart` block on request). The code is
`plugin/src/analytics/`; the agent tools are `ai/tools/AnalyticsTools.ts` (`read_data`,
`analyze_data`), the script side `scripting/analyticsApi.ts` (`analytics` in a script). The
reference agents read is `src/docs/analytics.md` (`query_docs` section `analytics`).

## Shape

- **A table** (`table.ts`) is typed columns (`date`, `number`, `money`, `string`, `boolean`,
  `list`) and rows of plain values, plus `meta` — what was read, what was left out and why. A
  column's type is inferred from its values when a source does not know it: 80% fitting is enough,
  and a value that does not fit is left empty and counted in `meta.unparsed`. A `level` column (a
  balance) defaults to `last` over a period and carries the previous value into an empty one.
- **Money** (`money.ts`) is whole minor units at the column's `scale` — at least 2, widened to the
  most decimal places any amount in the data has, at most 8. Totals are integer additions
  (`sumUnits` refuses a total past `MAX_SAFE_INTEGER` rather than rounding it); decimals appear
  only on the way out. Means, slopes and forecasts are floats and are rounded for reading by
  `tidy`.
- **The arithmetic** is pure and dependency-free: `stats.ts` (describe, percentiles by linear
  interpolation — numpy's default), `resample.ts` (UTC date keys, every period in the range
  present, `fill`), `trend.ts` (OLS against position, seasonality), `correlate.ts` (Pearson,
  Spearman with averaged ranks, p from `tdist.ts`), `forecast.ts`, `anomalies.ts`. Each is tested
  against small datasets worked by hand in `tests/unit/analyticsMath.test.ts`.
- **The spec** (`spec.ts`, `analyze.ts`, `group.ts`): filter rows, pick the value and date
  columns, group (`by`, and by currency whenever money is in more than one), rank the groups and
  fold the tail into `other`, then per group build the period series and run each analysis.

## Sources

- **Finance** (`sources/finance.ts`, `financeBalances.ts`) reads the metadata cache directly, not
  the `TransactionsList` the screens use, so it works whether or not a finance screen was ever
  opened. Links resolve from the transaction's own note, as `BalanceIndex` resolves them. What a
  wallet sees of a cross-currency transfer is `entities/walletAmount.ts`, extracted from
  `BalanceIndex` so both use one rule; the balance test compares the two. `kind` follows the
  finance sidebar: to an expense account is spending, from a revenue account is income, anything
  else a transfer.
- **Currency conversion** (`rates.ts`) has no rate table to use: the plugin has none. It takes the
  rates the vault's two-currency transactions imply, nearest on or before the date (else after),
  direct, inverted or through one third currency, and reports every rate it used. What it cannot
  convert is left out and counted, never summed as the target currency.
- **Notes** (`sources/notes.ts`): folder, type, properties, tag; the date from a property, a
  `YYYY-MM-DD` in the file name, `date` or `created`.
- **Bases** (`sources/base.ts`, `baseProbe.ts`): the public API has no headless query, so the
  base's YAML is rendered offscreen as a ```` ```base ```` block with the chosen view's type
  swapped for `abele-chart`. The factory registered for that id (`main.ts`) builds a
  `BaseProbeView` instead of a chart when the container sits in a probe host, and that view hands
  over `this.data` and the view's property order. The host must be inside the viewport — an embed
  only runs its query once it is seen — so it is laid out at the top left, transparent, under
  everything, and removed with its component whether the read succeeds, fails or times out.
  Values come typed from the Bases `Value` classes, read through their static `type` (class names
  are minified).

## Scope

The agent tools check every transaction, note and base row, and every account a balance adds
up, against the chat's scope and count what they leave out. The scope is taken once, when the
call starts (`sourceDeps`): a base is read across awaits, and another chat's tool call can make its
own scope the active one meanwhile. A base file out of scope is refused. Implied
rates come only from transactions in scope. Scripts read the whole vault, as their other file
operations do (`skipScope`).

## Tests

`analyticsMath` (the arithmetic), `analyticsSources` (finance, notes, the exact-money cases, the
comparison with `BalanceIndex`), `analyticsAnalyze` (the spec and both tools),
`analyticsScripts`. `tests/e2e/analytics.e2e.test.ts` runs in the app: a year of monthly spending
against a sum made from the files on disk, a balance against `BalanceIndex`, a base read through
the probe, the tool through `createAgentTools`, and the chart view still drawing.
