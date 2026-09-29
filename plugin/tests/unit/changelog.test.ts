import { describe, expect, it, vi } from 'vitest'
import { compareVersions, normalizeRange, selectReleases } from '../../src/changelog/model'
import { recordRun } from '../../src/changelog/controller'
import { startChangelog } from '../../src/changelog/startup'

const catalog = ['1.10.0', '1.9.0', '1.2.0', '1.0.0'].map((version) => ({ version }))
const store = (initial?: unknown) => {
  let value = initial
  return {
    read: () => value,
    write: vi.fn((next: unknown) => {
      value = next
    }),
  }
}

describe('changelog versions', () => {
  it('compares numeric components and standard prerelease identifiers', () => {
    for (const [a, b] of [
      ['1.10.0', '1.9.9'],
      ['2.0.0', '1.99.99'],
      ['1.1.0', '1.0.9'],
      ['1.0.2', '1.0.1'],
    ])
      expect(compareVersions(a, b)).toBe(1)
    expect(compareVersions('1.2.0-beta.2', '1.2.0-beta.10')).toBe(-1)
    expect(compareVersions('1.2.0-rc.1', '1.2.0')).toBe(-1)
    expect(compareVersions('1.2.0-2', '1.2.0-alpha')).toBe(-1)
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0)
    for (const bad of ['1.02.0', '1.0', 'v1.0.0', '', '1.2.0-alpha.01', '9007199254740993.0.0'])
      expect(compareVersions(bad, '1.2.0')).toBeNull()
  })
  it('filters lower-exclusive upper-inclusive ranges with unknown lower bounds and skipped versions', () => {
    expect(selectReleases(catalog, { from: '1.1.0', to: '1.9.0' }).map((x) => x.version)).toEqual([
      '1.9.0',
      '1.2.0',
    ])
    expect(selectReleases(catalog, { from: '1.9.0', to: '1.9.0' })).toEqual([])
    expect(selectReleases(catalog, { from: 'bad', to: '1.9.0' })).toEqual([])
    expect(selectReleases(catalog, { from: '1.9.0', to: '1.2.0' })).toEqual([])
    expect(normalizeRange({ from: '1.2.0', to: '9.0.0' }, '1.10.0')).toEqual({
      from: '1.2.0',
      to: '1.10.0',
    })
    for (const range of [null, {}, { from: 'bad', to: '1.10.0' }, { from: '1.9.0', to: '1.2.0' }])
      expect(normalizeRange(range, '1.10.0')).toBeNull()
  })
})

describe('device-local changelog baseline', () => {
  it('baselines fresh or invalid records and makes no needless same-version write', () => {
    for (const initial of [
      undefined,
      null,
      '1.0.0',
      { schema: 2, lastRunVersion: '1.0.0' },
      { schema: 1, lastRunVersion: 'bad' },
    ]) {
      const local = store(initial)
      expect(recordRun(local, '1.2.0')).toBeNull()
      expect(recordRun(local, '1.2.0')).toBeNull()
      expect(local.write).toHaveBeenCalledOnce()
    }
  })
  it('captures old version, records before offer, and supports downgrade then re-upgrade', () => {
    const local = store({ schema: 1, lastRunVersion: '1.2.0' })
    expect(recordRun(local, '1.10.0')).toEqual({ from: '1.2.0', to: '1.10.0' })
    expect(local.read()).toEqual({ schema: 1, lastRunVersion: '1.10.0' })
    expect(recordRun(local, '1.10.0')).toBeNull()
    expect(recordRun(local, '1.9.0')).toBeNull()
    expect(recordRun(local, '1.10.0')).toEqual({ from: '1.9.0', to: '1.10.0' })
  })
  it('does not share records between devices or vaults', () => {
    const locals = [store(), store(), store(), store()]
    locals.forEach((local) => expect(recordRun(local, '1.2.0')).toBeNull())
    expect(recordRun(locals[0], '1.3.0')).toEqual({ from: '1.2.0', to: '1.3.0' })
    expect(recordRun(locals[1], '1.2.0')).toBeNull()
    expect(recordRun(locals[2], '1.4.0')).toEqual({ from: '1.2.0', to: '1.4.0' })
    expect(recordRun(locals[3], '1.2.0')).toBeNull()
  })
  it('keeps startup alive and suppresses unrecordable offers', () => {
    const readFailure = {
      read: () => {
        throw Error('read failed')
      },
      write: vi.fn(),
    }
    expect(recordRun(readFailure, '1.3.0')).toBeNull()
    expect(readFailure.write).not.toHaveBeenCalled()
    const writeFailure = {
      read: () => ({ schema: 1, lastRunVersion: '1.0.0' }),
      write: () => {
        throw Error('write failed')
      },
    }
    expect(recordRun(writeFailure, '1.3.0')).toBeNull()
    const local = store()
    expect(recordRun(local, 'bad')).toBeNull()
    expect(local.write).not.toHaveBeenCalled()
  })
  it('waits for layout, offers once and cancels callbacks/notices on unload', () => {
    let ready = () => {}
    const local = store({ schema: 1, lastRunVersion: '1.0.0' })
    const hide = vi.fn(),
      offer = vi.fn(() => hide)
    const stop = startChangelog(
      local,
      '1.2.0',
      (cb) => {
        ready = cb
      },
      offer
    )
    expect(offer).not.toHaveBeenCalled()
    ready()
    ready()
    expect(offer).toHaveBeenCalledExactlyOnceWith({ from: '1.0.0', to: '1.2.0' })
    stop()
    expect(hide).toHaveBeenCalledOnce()
    const stop2 = startChangelog(
      local,
      '1.3.0',
      (cb) => {
        ready = cb
      },
      offer
    )
    stop2()
    ready()
    expect(offer).toHaveBeenCalledTimes(1)
    startChangelog(
      local,
      '1.3.0',
      (cb) => {
        ready = cb
      },
      offer
    )
    ready()
    expect(offer).toHaveBeenCalledTimes(1)
  })
})
