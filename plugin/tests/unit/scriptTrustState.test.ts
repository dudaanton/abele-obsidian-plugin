/**
 * Which versions of the scripts a device vouches for: written here, confirmed here, or there
 * when checking was switched on. Anything else is from elsewhere and waits.
 */
import { describe, it, expect } from 'vitest'
import {
  armedWith,
  armsFromSettings,
  disarmed,
  emptyTrust,
  MAX_TEXT,
  reconciled,
  trustStateFrom,
  verdictOf,
  withArrival,
  withConfirmed,
} from '@/scripting/trustState'

const file = (path: string, hash: string, text = `text of ${hash}`) => ({ path, hash, text })

describe('script trust state', () => {
  it('lets everything run while checking is off', () => {
    expect(verdictOf(emptyTrust(), 'S/a.js', 'h1')).toBe('confirmed')
    expect(verdictOf(emptyTrust(), 'S/a.js', undefined)).toBe('confirmed')
  })

  it('takes every script as it is when checking is switched on', () => {
    const state = armedWith(emptyTrust(), [file('S/a.js', 'h1'), file('S/b.js', 'h2')])
    expect(state.armed).toBe(true)
    expect(verdictOf(state, 'S/a.js', 'h1')).toBe('confirmed')
    expect(verdictOf(state, 'S/b.js', 'h2')).toBe('confirmed')
  })

  it('holds a version that was not written or confirmed here', () => {
    const state = armedWith(emptyTrust(), [file('S/a.js', 'h1')])
    expect(verdictOf(state, 'S/a.js', 'changed')).toBe('waiting')
    expect(verdictOf(state, 'S/new.js', 'fresh')).toBe('waiting')
    expect(verdictOf(state, 'S/a.js', undefined)).toBe('waiting')
  })

  it('confirms a version, and keeps it as the one the next diff is against', () => {
    let state = armedWith(emptyTrust(), [file('S/a.js', 'h1', 'old')])
    state = withConfirmed(state, 'S/a.js', 'h2', 'new')
    expect(verdictOf(state, 'S/a.js', 'h2')).toBe('confirmed')
    expect(state.scripts['S/a.js']).toEqual({ hash: 'h2', text: 'new' })
  })

  it('does not record anything while checking is off', () => {
    expect(withConfirmed(emptyTrust(), 'S/a.js', 'h1', 'x').scripts).toEqual({})
  })

  it('keeps only the hash of a huge version', () => {
    const state = armedWith(emptyTrust(), [file('S/a.js', 'h1', 'x'.repeat(MAX_TEXT + 1))])
    expect(state.scripts['S/a.js']).toEqual({ hash: 'h1' })
  })

  it('vouches for a version at any path, so a rename or a copy stays confirmed', () => {
    const state = armedWith(emptyTrust(), [file('S/a.js', 'h1')])
    expect(verdictOf(state, 'S/renamed.js', 'h1')).toBe('confirmed')
  })

  it('carries a renamed script over and drops paths that are gone', () => {
    let state = armedWith(emptyTrust(), [file('S/a.js', 'h1'), file('S/b.js', 'h2')])
    state = reconciled(state, [file('S/renamed.js', 'h1')])
    expect(Object.keys(state.scripts)).toEqual(['S/renamed.js'])
    expect(verdictOf(state, 'S/renamed.js', 'h1')).toBe('confirmed')
  })

  it('keeps the last confirmed version of a waiting script for its diff', () => {
    let state = armedWith(emptyTrust(), [file('S/a.js', 'h1', 'old')])
    state = reconciled(state, [file('S/a.js', 'h9', 'arrived')])
    expect(state.scripts['S/a.js']).toEqual({ hash: 'h1', text: 'old' })
    expect(verdictOf(state, 'S/a.js', 'h9')).toBe('waiting')
  })

  it('forgets everything when switched off, so switching on again starts afresh', () => {
    const state = disarmed()
    expect(state.scripts).toEqual({})
    expect(state.armed).toBe(false)
  })

  it('is armed by the setting only on a device that never switched it off itself', () => {
    expect(armsFromSettings(emptyTrust(), true)).toBe(true)
    expect(armsFromSettings(emptyTrust(), false)).toBe(false)
    // Switched off here: the setting arriving on again from another device does not re-arm it.
    expect(armsFromSettings(disarmed(), true)).toBe(false)
    // Switched on here again: armed, and no longer declined.
    const again = armedWith(disarmed(), [])
    expect(again.declined).toBe(false)
    expect(armsFromSettings(again, true)).toBe(false)
    // Stored and read back, the "no" survives.
    expect(trustStateFrom(JSON.parse(JSON.stringify(disarmed()))).declined).toBe(true)
  })

  describe('a source with a policy of its own', () => {
    const base = () => armedWith(emptyTrust(), [file('S/a.js', 'h1')])

    it('accept: runs as it came', () => {
      const state = withArrival(base(), 'S/a.js', 'h2', 'x', 'accept')
      expect(verdictOf(state, 'S/a.js', 'h2')).toBe('confirmed')
    })

    it('confirm: waits', () => {
      const state = withArrival(base(), 'S/a.js', 'h2', 'x', 'confirm')
      expect(verdictOf(state, 'S/a.js', 'h2')).toBe('waiting')
    })

    it('refuse: never runs that version, even where it was vouched for elsewhere', () => {
      let state = withConfirmed(base(), 'S/b.js', 'h2', 'x')
      state = withArrival(state, 'S/a.js', 'h2', 'x', 'refuse')
      expect(verdictOf(state, 'S/a.js', 'h2')).toBe('refused')
    })

    it('refuse: a version written here afterwards outranks it', () => {
      let state = withArrival(base(), 'S/a.js', 'h2', 'x', 'refuse')
      state = withConfirmed(state, 'S/a.js', 'h2', 'x')
      expect(verdictOf(state, 'S/a.js', 'h2')).toBe('confirmed')
    })
  })

  it('reads back what it stored, and drops what it cannot read', () => {
    const state = withArrival(
      armedWith(emptyTrust(), [file('S/a.js', 'h1', 'one')]),
      'S/b.js',
      'bad',
      'x',
      'refuse'
    )
    expect(trustStateFrom(JSON.parse(JSON.stringify(state)))).toEqual(state)
    expect(trustStateFrom(null)).toEqual(emptyTrust())
    expect(trustStateFrom('garbage')).toEqual(emptyTrust())
    expect(
      trustStateFrom({
        armed: true,
        scripts: { 'S/a.js': { text: 'no hash' }, x: null },
        refused: [1],
      })
    ).toEqual({ armed: true, declined: false, scripts: {}, refused: [] })
    // Anything but a plain `true` is off: a half-written record must not hold every script.
    expect(trustStateFrom({ armed: 'yes' }).armed).toBe(false)
  })
})
