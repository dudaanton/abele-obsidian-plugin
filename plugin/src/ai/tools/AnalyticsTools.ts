/**
 * Numbers out of the vault for an agent: `read_data` shows what a source holds, `analyze_data`
 * runs statistics, trends, correlations, forecasts and anomaly checks on it — computed here,
 * exactly and the same way every time, instead of by the model in its head. Both only read.
 * See `src/analytics/` and the `analytics` section of the reference.
 */
import type { AgentTool } from '../client'
import { scopeOf } from '../toolContext'
import { analyzeSource, profileSource, type AnalyzeSpec } from '@/analytics'
import { AGGS, FILLS, PERIODS } from '@/analytics/resample'

export const READ_DATA = 'read_data'
export const ANALYZE_DATA = 'analyze_data'

const SOURCE_SCHEMA = {
  type: 'object',
  description:
    'Where the rows come from. ' +
    '{kind:"finance", measure?: "transactions"|"flow"|"balance", from?, to?, accounts?, categories?, ' +
    'only?: "income"|"expense"|"transfer", linkedTo?, currency?} — transactions (one row each), ' +
    'money in and out of `accounts` (flow), or balances over time (balance; net worth without accounts). ' +
    "`currency` converts with rates implied by the vault's own two-currency transactions. " +
    '{kind:"notes", folder?, type?, where?: {property: value}, tag?, date?, columns?, from?, to?} — ' +
    'one row per note, one column per property (e.g. daily notes with weight, sleep). ' +
    '{kind:"base", path: "X.base", view?} — the rows a view of a base shows, its filters and formulas applied.',
  properties: {
    kind: { type: 'string', enum: ['finance', 'notes', 'base'] },
  },
  required: ['kind'],
}

const WHERE_SCHEMA = {
  type: 'array',
  description:
    'Row filters, all must hold: {column, op?: "="|"!="|">"|">="|"<"|"<="|"contains"|"in", value}. ' +
    'Text compares ignoring case; a list column matches when any item does.',
  items: {
    type: 'object',
    properties: {
      column: { type: 'string' },
      op: { type: 'string', enum: ['=', '!=', '>', '>=', '<', '<=', 'contains', 'in'] },
      value: {},
    },
    required: ['column', 'value'],
  },
}

const json = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export function createReadDataTool(): AgentTool {
  return {
    name: READ_DATA,
    label: 'Read data',
    description:
      'See what a data source holds before analysing it: its columns with their types and a short ' +
      'profile of each (range and mean of numbers, span of dates, commonest values of text), how many ' +
      'rows, and the first rows. Sources: finance (transactions, flows, balances), notes by folder/type/' +
      'property (e.g. daily notes with health properties), or a .base file. Money comes back as decimals. ' +
      'For any arithmetic — totals, averages, trends, correlations, forecasts — use analyze_data instead ' +
      'of computing it yourself.',
    parameters: {
      type: 'object',
      properties: {
        source: SOURCE_SCHEMA,
        where: WHERE_SCHEMA,
        limit: { type: 'number', description: 'How many rows to show (default 20, at most 500)' },
      },
      required: ['source'],
    },
    execute: async (_id, params, _signal, ctx) =>
      json(
        await profileSource(params.source, {
          scope: scopeOf(ctx),
          where: params.where as AnalyzeSpec['where'],
          limit: params.limit as number | undefined,
        })
      ),
  }
}

export function createAnalyzeDataTool(): AgentTool {
  return {
    name: ANALYZE_DATA,
    label: 'Analyze data',
    description:
      'Statistics over vault data, computed exactly (money totals to the cent, no float drift): ' +
      'describe (count, sum, mean, median, stdev, percentiles, min/max), totals per group (`by`), ' +
      'series per day/week/month/quarter/year with empty periods filled, rolling averages, trend ' +
      '(slope per period, r², % change), seasonality (by month or weekday), correlation with another ' +
      'column or source (Pearson/Spearman with n, p-value and a plain hint), rough forecasts with ' +
      '80%/95% ranges (linear, moving-average, seasonal), anomalies (IQR or z-score). ' +
      'Money in several currencies is kept apart unless the source converts it. Returns compact JSON; ' +
      'with chart: true also an abele-chart block to paste into your answer as it is. ' +
      'Examples: monthly spending trend — {source:{kind:"finance", only:"expense", currency:"EUR"}, ' +
      'period:"month", analyses:["trend","forecast"], chart:true}; spending per category — ' +
      '{source:{kind:"finance", only:"expense", from:"2026-01-01"}, by:"category"}; sleep vs weight — ' +
      '{source:{kind:"notes", folder:"Daily"}, value:"sleep", period:"week", analyses:[{type:"correlate", ' +
      'with:{value:"weight"}}]}. Full reference: query_docs section "analytics".',
    parameters: {
      type: 'object',
      properties: {
        source: SOURCE_SCHEMA,
        where: WHERE_SCHEMA,
        value: {
          type: 'string',
          description:
            'The number or money column to analyse (default: amount/balance for finance, else the first number column)',
        },
        date: { type: 'string', description: 'The date column (default: "date")' },
        by: { type: 'string', description: 'Group by this column (a list column: by each item)' },
        period: { type: 'string', enum: PERIODS, description: 'Bucket rows into periods' },
        agg: {
          type: 'string',
          enum: AGGS,
          description:
            'How rows combine in a period or group (default: sum for money, last for balances, mean otherwise)',
        },
        fill: {
          type: 'string',
          enum: FILLS,
          description:
            'Empty periods: zero (default for sums), previous (default for balances), linear, none (default otherwise)',
        },
        from: { type: 'string', description: 'First date of the periods, YYYY-MM-DD' },
        to: { type: 'string', description: 'Last date of the periods, YYYY-MM-DD' },
        limit: {
          type: 'number',
          description: 'Most groups to keep; the rest are folded into "other" (default 12)',
        },
        analyses: {
          type: 'array',
          description:
            'What to compute (default ["describe"]). Names, or objects for options: "describe", "series", ' +
            '{type:"rolling", window?, agg?}, "trend", {type:"seasonality", by?: "month"|"weekday"}, ' +
            '{type:"forecast", method?: "linear"|"moving-average"|"seasonal", horizon?, window?, season?}, ' +
            '{type:"anomalies", method?: "iqr"|"zscore", threshold?}, ' +
            '{type:"correlate", with:{value, source?, where?, agg?}, method?: "pearson"|"spearman", detrend?}',
          items: {},
        },
        chart: { type: 'boolean', description: 'Also return an abele-chart block' },
      },
      required: ['source'],
    },
    execute: async (_id, params, _signal, ctx) =>
      json(
        await analyzeSource(params as unknown as AnalyzeSpec & { source: unknown }, {
          scope: scopeOf(ctx),
        })
      ),
  }
}

export function createAnalyticsTools(): AgentTool[] {
  return [createReadDataTool(), createAnalyzeDataTool()]
}
