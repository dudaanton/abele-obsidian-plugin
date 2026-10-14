import { reactive } from 'vue'
import dayjs from 'dayjs'
import { formatAmount } from '@/helpers/moneyFormat'
import { tableStatus, unitRate, type RateTable } from './convert'

/**
 * What the screens read about exchange rates: the table on this device, whether fetching is on,
 * the currency everything is shown in, and what went wrong last. The daily fetch writes here;
 * until a table arrives nothing converted is shown and lists keep their own order.
 */
export const exchangeRates = reactive({
  enabled: true,
  /** What converted figures are shown in; the table itself is always against the dollar. */
  display: 'USD',
  table: null as RateTable | null,
  /** Short words for the settings line when the last fetch failed. */
  lastError: null as string | null,
  /** The source named in the settings line. */
  source: 'Frankfurter',
  /** Fetching now, from «Update now» or the daily turn. */
  updating: false,
  /** Fetches today's table at once; set by whatever does the daily fetch. */
  refresh: null as (() => void) | null,
})

/** The table to convert with: none while fetching is off. */
export const ratesTable = () => (exchangeRates.enabled ? exchangeRates.table : null)

export const ratesStatus = () =>
  exchangeRates.enabled ? tableStatus(exchangeRates.table, dayjs().format('YYYY-MM-DD')) : 'never'

/**
 * The words behind every `≈`: the day of the rates, the rate of each currency counted, those left
 * out, and where the rates came from. A stale table leads with what is wrong.
 */
export function ratesTooltip(currencies: string[], missing: string[] = []): string {
  const table = ratesTable()
  if (!table) return ''
  const to = exchangeRates.display
  const day = dayjs(table.fetchedOn).format('D MMM')
  const lines = [
    ratesStatus() === 'stale'
      ? `Rates from ${day}: could not update since`
      : `At today's rates, ${day}`,
  ]
  const rates = currencies
    .filter((c) => c !== to)
    .map((c) => {
      const r = unitRate(c, to, table)
      return r === null ? null : `1 ${c} = ${formatAmount(r, r < 0.01 ? 4 : 2)} ${to}`
    })
    .filter(Boolean)
  if (rates.length) lines.push(rates.join(' · '))
  if (missing.length) lines.push(`Not counted: ${missing.join(', ')}, no rate`)
  lines.push(exchangeRates.source)
  return lines.join('\n')
}
