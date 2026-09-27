# Analytics

Statistics over the vault with `read_data` and `analyze_data` (and `analytics` in scripts): where
the rows come from, what can be asked of them, how money and currencies are handled, and examples
of whole questions.

## Sources

Every call names a `source`, one of three kinds.

**Finance** — `{ kind: "finance", measure?, from?, to?, accounts?, categories?, only?, linkedTo?,
currency? }`.

- `measure: "transactions"` (the default): one row per transaction — `date`, `amount`, `currency`,
  `kind` (`income` when it comes from a revenue account, `expense` when it goes to an expense
  account, otherwise `transfer` — as the finance sidebar decides), `from`, `to`, `category`,
  `groups`, `path`. `amount` is always positive.
- `measure: "flow"`: the money in and out of the listed `accounts` — one row per transaction per
  listed account, `amount` signed (+ in, − out) in that account's own currency, with `account`,
  `counterparty`, `kind`. A transfer between two listed accounts nets to zero in any total.
  `accounts` is required.
- `measure: "balance"`: balances over time — one row per day a balance changed, plus the first and
  last day of the range, with `account` and `balance`. An account has no balance before its
  `startingBalanceDate`. Without `accounts` it is net worth: every asset and liability not
  excluded from totals. Only asset, liability and computed accounts have a balance; ask a category
  or an expense account for its `flow` or `transactions` instead. Balances are levels: over a
  period they take the last value, and an empty period carries the previous one.
- `accounts`, `categories`, `linkedTo` (a note the transactions have in `groups` — a trip, a
  project) take names, paths or links. `only` is `income`, `expense` or `transfer`. `from`/`to`
  are `YYYY-MM-DD`, both included.
- `currency: "EUR"` converts every amount into one currency. There is no rate table: the rates are
  the ones the vault's own two-currency transactions imply (`amount` in one currency,
  `foreignAmount` in another) — the nearest on or before each date, else the nearest after,
  directly, inverted, or through one third currency. The answer lists every rate it used under
  `source.ratesUsed`. An amount no rate reaches is left out and counted under
  `source.unconverted`, with a warning — never added in as if it were the target currency.

**Notes** — `{ kind: "notes", folder?, type?, where?, tag?, date?, columns?, from?, to? }`: one row
per note, a column per property. `where` is `{ property: value }` (a list property matches when it
contains the value). The date is `date`'s property, or else a `YYYY-MM-DD` in the file name (daily
notes), then `date`, then `created`. `columns` limits which properties are read. A column's type is
read from its values: `"7,5"` is a number; a value that does not fit its column (`weight: heavy`) is
left empty and counted under `source.unparsed`.

**Base** — `{ kind: "base", path: "Health.base", view? }`: the rows a view of a `.base` file shows
— its filters, formulas, sort and limit applied by Obsidian itself — with a column per property
the view shows (`note.weight` becomes `weight`; `file.name` and `formula.x` keep their names) and
`path`. The first view when none is named.

Rows outside the chat's scope are left out of every source and counted under `source.outOfScope`.

## Asking

`analyze_data` takes the source and:

- `where` — row filters, all must hold: `{ column, op?, value }`, `op` one of `=` (default), `!=`,
  `>`, `>=`, `<`, `<=`, `contains`, `in` (value a list). Text compares ignoring case.
- `value` — the number or money column (default `amount` / `balance`, else the first number column).
- `date` — the date column (default `date`).
- `by` — group by a column; a list column (`groups`) groups by each item. `limit` keeps the largest
  groups (default 12) and folds the rest into one `other (n)`. Group totals come with `share` in
  percent when they are sums in one currency.
- `period` — `day`, `week` (starting on the day the settings say), `month`, `quarter`, `year`: the
  rows become a series of periods, every period in the range present. `from`/`to` set the range.
- `agg` — how rows combine: `sum` (default for money), `last` (default for balances), `mean`
  (default otherwise), `median`, `min`, `max`, `count`, `first`.
- `fill` — what an empty period holds: `zero` (default for sums and counts), `previous` (default for
  balances), `linear`, `none` (default otherwise; left out of trends and forecasts).
- `analyses` — a list, default `["describe"]`. With a `period` each works on the series; without
  one on the rows oldest first, except trend, forecast, rolling and correlate, which pick a period
  (month for money, day otherwise) and say which.
- `chart: true` — an `abele-chart` block under `chart`: lines per period (one per group, plus the
  rolling mean and the forecast with its 80% range for one series), or bars of group totals.

Money in more than one currency is split by currency automatically, as if grouped by it, with a
warning; give the source a `currency` to have one total.

## Analyses

- `describe` — count, missing, sum, mean, median, stdev and variance (sample, n − 1), min, max, 10th,
  25th, 75th and 90th percentiles (interpolated, as in Excel's `PERCENTILE.INC`). A money sum is
  added up exactly.
- `series` — list every period even when there are many (up to 60 are listed anyway).
- `{ type: "rolling", window?: 3, agg?: "mean" | "sum" }` — a place whose window is not full or
  holds a gap is empty.
- `trend` — least-squares slope per period, r² (how much a straight line explains), first and last
  value, `changePct` (last against first) and `lastVsPreviousPct`, `direction` (`flat` when r² <
  0.1) and `strength`.
- `{ type: "seasonality", by?: "month" | "weekday" }` — the mean per month of the year or day of the
  week, `index` against the overall mean (1.2 = 20% above usual) and `n` behind each.
- `{ type: "forecast", method?, horizon?: 3, window?, season? }` — `linear` (the trend line carried
  on, t-based prediction interval), `moving-average` (the mean of the last `window`), `seasonal`
  (the value one season ago; the default once there are two full seasons). Each point has `lo80`,
  `hi80`, `lo95`, `hi95`. It is a rough estimate from the past alone — say so when you pass it on.
- `{ type: "anomalies", method?: "iqr" | "zscore", threshold? }` — `iqr` (default) flags values past
  1.5 interquartile ranges outside the middle half; `zscore` values more than 3 standard deviations
  from the mean. Without a period the unusual rows come back with their date, text columns and
  path — which transaction, which day.
- `{ type: "correlate", with: { value, source?, where?, agg? }, method?: "pearson" | "spearman",
  detrend? }` — the series against another column of the same source or of another source, paired
  by period. Answers `r`, `n` (pairs where both have a value), `p` and a `hint` in words. A
  `warning` comes when both series trend over time, which alone makes them look related; ask again
  with `detrend: true` to correlate their period-to-period changes. Spearman is steadier with
  outliers. Report `n` and the hint along with `r`, and never present a correlation as a cause.

## Examples

Monthly spending in euros, where it is heading and the next three months:

```json
{ "source": { "kind": "finance", "only": "expense", "currency": "EUR", "from": "2025-01-01" },
  "period": "month", "analyses": ["describe", "trend", "forecast"], "chart": true }
```

Where the money went this year, by category:

```json
{ "source": { "kind": "finance", "only": "expense", "from": "2026-01-01" }, "by": "category" }
```

The balance of one account at the end of each month:

```json
{ "source": { "kind": "finance", "measure": "balance", "accounts": ["Revolut EUR"] },
  "period": "month", "analyses": ["series"] }
```

Whether sleep goes with weight, week by week, from daily notes:

```json
{ "source": { "kind": "notes", "folder": "Journal/Daily" }, "value": "sleep", "period": "week",
  "analyses": [{ "type": "correlate", "with": { "value": "weight" }, "method": "spearman" }] }
```

Spending against a health measure from a base:

```json
{ "source": { "kind": "finance", "only": "expense", "currency": "EUR" }, "period": "week",
  "analyses": [{ "type": "correlate",
                 "with": { "source": { "kind": "base", "path": "Health.base" }, "value": "steps" } }] }
```

Unusual transactions last quarter:

```json
{ "source": { "kind": "finance", "only": "expense", "from": "2026-07-01", "to": "2026-09-30" },
  "analyses": ["anomalies"] }
```

## In scripts

`analytics.read(source)` gives `{ columns, rows, meta }` with money in decimals;
`analytics.profile(source, { where?, limit? })` is `read_data`'s answer and
`analytics.analyze(spec)` is `analyze_data`'s, both as objects. The functions underneath take
plain arrays: `describe`, `median`, `percentile(values, p)`, `resample(points, opts)`,
`rolling(values, window)`, `linearFit`, `trend`, `seasonality`, `correlation(xs, ys, opts)`,
`pearson`, `spearman`, `forecast(values, opts)`, `anomalies(values, opts)`. See `script_api_docs`.
