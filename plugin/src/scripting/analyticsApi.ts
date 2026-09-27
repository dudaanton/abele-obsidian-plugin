/**
 * `analytics` in a script: the same sources and analysis spec the `read_data` and `analyze_data`
 * tools use, answering with objects instead of JSON text, plus the plain functions under them for
 * a script that has its own numbers.
 */
import { analyzeSource, profileSource, readTable, type AnalyzeSpec, type Filter } from '@/analytics'
import { anomalies } from '@/analytics/anomalies'
import { correlation, pearson, spearman } from '@/analytics/correlate'
import { forecast } from '@/analytics/forecast'
import { resample, rolling } from '@/analytics/resample'
import { describe, median, percentile } from '@/analytics/stats'
import { linearFit, seasonality, trend } from '@/analytics/trend'

const WHOLE_VAULT = { skipScope: true }

export function scriptAnalytics() {
  return {
    // The whole vault, as a script's other file operations reach it.
    /** A source as `{ columns, rows, meta }`, money in decimals. */
    read: (source: unknown) => readTable(source, WHOLE_VAULT),
    /** What a source holds: columns profiled, row count, the first rows. */
    profile: (source: unknown, opts: { where?: Filter[]; limit?: number } = {}) =>
      profileSource(source, { ...opts, ...WHOLE_VAULT }),
    /** An analysis spec, `source` included — the `analyze_data` answer as an object. */
    analyze: (spec: AnalyzeSpec & { source: unknown }) => analyzeSource(spec, WHOLE_VAULT),
    describe,
    median,
    percentile: (values: number[], p: number) =>
      percentile(
        [...values].sort((a, b) => a - b),
        p
      ),
    resample,
    rolling,
    linearFit,
    trend,
    seasonality,
    correlation,
    pearson,
    spearman,
    forecast,
    anomalies,
  }
}
