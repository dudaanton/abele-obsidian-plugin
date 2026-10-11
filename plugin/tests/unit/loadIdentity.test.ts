import { expect, it } from 'vitest'
import { wasReloaded } from '../e2e/helpers/loadIdentity'

it('ignores time origin jitter when the per-load id is unchanged', () => {
  expect(
    wasReloaded(
      { loadId: 'sample-load', timeOrigin: 10000 },
      { loadId: 'sample-load', timeOrigin: 10002 }
    )
  ).toBe(false)
  expect(
    wasReloaded(
      { loadId: 'sample-load', timeOrigin: 10000 },
      { loadId: 'sample-load', timeOrigin: 20000 }
    )
  ).toBe(false)
})
it('detects a different per-load id even when time origin is unchanged', () => {
  expect(
    wasReloaded(
      { loadId: 'sample-load', timeOrigin: 10000 },
      { loadId: 'other-load', timeOrigin: 10000 }
    )
  ).toBe(true)
})
it('uses a difference above one second when either load id is missing', () => {
  for (const loadId of [undefined, 'sample-load']) {
    expect(wasReloaded({ loadId, timeOrigin: 10000 }, { timeOrigin: 10002 })).toBe(false)
    expect(wasReloaded({ loadId, timeOrigin: 10000 }, { timeOrigin: 11000 })).toBe(false)
    expect(wasReloaded({ loadId, timeOrigin: 10000 }, { timeOrigin: 11001 })).toBe(true)
    expect(wasReloaded({ timeOrigin: 10000 }, { loadId, timeOrigin: 8999 })).toBe(true)
  }
})
