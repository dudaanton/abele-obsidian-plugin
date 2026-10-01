import type { Deck, DeckSource } from './model'

/** Latest-source-wins: disk/network reads must not overwrite a newer local editor preview. */
export class DeckFollower {
  private revision = 0
  private closed = false
  private readonly unwatch: () => void

  constructor(
    private readonly source: DeckSource,
    private readonly apply: (deck: Deck) => void
  ) {
    this.unwatch = source.watch(() => {
      void this.refresh()
    })
  }

  async refresh(): Promise<void> {
    const revision = ++this.revision
    try {
      const deck = await this.source.read()
      if (!this.closed && revision === this.revision) this.apply(deck)
    } catch (error) {
      if (!this.closed && revision === this.revision)
        console.warn('[Abele] presentation could not be refreshed', error)
    }
  }

  replace(deck: Deck): void {
    ++this.revision
    if (!this.closed) this.apply(deck)
  }

  invalidate(): void {
    ++this.revision
  }
  stop(): void {
    if (this.closed) return
    this.closed = true
    this.invalidate()
    this.unwatch()
  }
}
