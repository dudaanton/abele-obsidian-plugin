import { describe, expect, it, vi } from 'vitest'
import { DeckFollower } from '@/slides/core/DeckFollower'
import { parseDeck } from '@/slides/core/markdown'
import type { Deck } from '@/slides/core/model'

describe('following a presentation source', () => {
  it('does not replace a newer editor preview with an old file read', async () => {
    let finish!: (deck: Deck) => void
    const apply = vi.fn()
    const follower = new DeckFollower(
      {
        read: () =>
          new Promise((r) => {
            finish = r
          }),
        watch: () => () => {},
      },
      apply
    )
    const pending = follower.refresh()
    const fresh = parseDeck('# Fresh editor')
    follower.replace(fresh)
    finish(parseDeck('# Old file'))
    await pending
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith(fresh)
    follower.stop()
  })

  it('ignores out-of-order reads and reads completed after closing', async () => {
    const pending: ((deck: Deck) => void)[] = []
    let changed!: () => void
    const stop = vi.fn(),
      apply = vi.fn()
    const follower = new DeckFollower(
      {
        read: () => new Promise((r) => pending.push(r)),
        watch: (fn) => {
          changed = fn
          return stop
        },
      },
      apply
    )
    const first = follower.refresh(),
      second = follower.refresh()
    const latest = parseDeck('# Latest')
    pending[1](latest)
    await second
    pending[0](parseDeck('# Older'))
    await first
    expect(apply).toHaveBeenCalledTimes(1)
    changed()
    follower.stop()
    pending[2](parseDeck('# Closed'))
    await Promise.resolve()
    await Promise.resolve()
    expect(apply).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
  })
})
