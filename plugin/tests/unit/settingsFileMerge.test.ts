/**
 * The merge a save or a reload makes when a settings file arrived under changes made in memory:
 * what changed here (`localChanges`) put back on top of what arrived (`reapply`).
 *
 * The file syncs, so a key in it may have been written by hand on any device. A `__proto__` key
 * survives `JSON.parse` as an own key, and walked into as a path it would re-prototype the copy
 * the merge builds instead of setting a field on it. Neither half may walk such a name.
 */
import { describe, it, expect } from 'vitest'
import { localChanges, reapply } from '@/services/settingsFile'

describe('the settings merge and names that reach a prototype', () => {
  it('does not count a change under __proto__, prototype or constructor', () => {
    const base = { ai: { enabled: true } }
    const mine = JSON.parse(
      '{"ai":{"enabled":false,"__proto__":{"polluted":1},"constructor":{"prototype":{"x":1}}}}'
    ) as unknown

    const changes = localChanges(base, mine)

    expect(changes).toEqual([{ path: ['ai', 'enabled'], value: false }])
  })

  it('puts nothing back through such a name, and leaves every prototype alone', () => {
    const theirs = { ai: { enabled: true } }

    const result = reapply(theirs, [
      { path: ['ai', '__proto__'], value: { polluted: 1 } },
      { path: ['ai', 'constructor', 'prototype', 'polluted'], value: 1 },
      { path: ['ai', 'enabled'], value: false },
    ]) as { ai: Record<string, unknown> }

    expect(Object.getPrototypeOf(result.ai)).toBe(Object.prototype)
    expect(result.ai.polluted).toBeUndefined()
    expect(Object.keys(result.ai)).toEqual(['enabled'])
    expect(result.ai.enabled).toBe(false)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('still merges an ordinary field under an object', () => {
    const result = reapply({ reader: { size: 1, font: 'a' } }, [
      { path: ['reader', 'size'], value: 2 },
    ])

    expect(result).toEqual({ reader: { size: 2, font: 'a' } })
  })
})
