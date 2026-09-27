/**
 * Exchange rates the vault already holds: every transaction written in two currencies —
 * `amount currency` and `foreignAmount foreignCurrency` — says what one was worth in the other
 * that day. There is no other rate table in the plugin, and nothing is fetched from anywhere.
 *
 * A conversion takes the rate from the nearest day on or before the date, else the nearest
 * after; the pair directly or inverted; failing that, through one third currency. Every rate used
 * is reported, so an answer in one currency says what it rests on.
 */

export interface RateObservation {
  date: string
  from: string
  to: string
  /** Units of `to` per unit of `from`. */
  rate: number
}

export interface RateUse {
  from: string
  to: string
  rate: number
  date: string
  via?: string
}

export class ImpliedRates {
  private byPair = new Map<string, { date: string; rate: number }[]>()
  readonly used = new Map<string, RateUse>()

  constructor(observations: Iterable<RateObservation>) {
    for (const o of observations) {
      if (!(o.rate > 0) || !Number.isFinite(o.rate) || o.from === o.to) continue
      this.add(o.from, o.to, o.date, o.rate)
      this.add(o.to, o.from, o.date, 1 / o.rate)
    }
    for (const list of this.byPair.values()) list.sort((a, b) => (a.date < b.date ? -1 : 1))
  }

  private add(from: string, to: string, date: string, rate: number): void {
    const key = `${from}>${to}`
    let list = this.byPair.get(key)
    if (!list) this.byPair.set(key, (list = []))
    list.push({ date, rate })
  }

  get currencies(): string[] {
    const set = new Set<string>()
    for (const key of this.byPair.keys()) key.split('>').forEach((c) => set.add(c))
    return [...set].sort()
  }

  private direct(from: string, to: string, date: string): { rate: number; date: string } | null {
    const list = this.byPair.get(`${from}>${to}`)
    if (!list?.length) return null
    // The last on or before the date, else the first after it.
    let lo = 0
    let hi = list.length - 1
    let at = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (list[mid].date <= date) {
        at = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return list[at >= 0 ? at : 0]
  }

  /** The rate from `from` to `to` on `date`, or null when the vault holds no way across. */
  rate(from: string, to: string, date: string): number | null {
    if (from === to) return 1
    const d = this.direct(from, to, date)
    if (d) {
      this.note({ from, to, rate: d.rate, date: d.date })
      return d.rate
    }
    for (const via of this.currencies) {
      if (via === from || via === to) continue
      const a = this.direct(from, via, date)
      const b = a && this.direct(via, to, date)
      if (a && b) {
        const rate = a.rate * b.rate
        this.note({ from, to, rate, date: a.date < b.date ? a.date : b.date, via })
        return rate
      }
    }
    return null
  }

  private note(use: RateUse): void {
    // One line per pair: the latest date it was used at is the one worth showing.
    const key = `${use.from}>${use.to}`
    const seen = this.used.get(key)
    if (!seen || use.date > seen.date) this.used.set(key, use)
  }
}
