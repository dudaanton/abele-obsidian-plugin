// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { SyncDriver } from '../e2e/helpers/syncDriver'

function pool(registry: unknown, liveRecords: unknown[] = [], candidates: unknown[] = []) {
  const device = new SyncDriver(() => {
    throw new Error('No live app in unit tests')
  })
  const app = { loadLocalStorage: () => registry }
  const svc = {
    registry: { records: () => liveRecords },
    rows: { value: [] },
    candidates: { value: candidates },
    questions: { value: [] },
  }
  const run = vi
    .spyOn(device, 'run')
    .mockImplementation((body) => new Function('app', 'svc', body)(app, svc))
  device.retire()
  return { device, run }
}
const empty = { version: 2, selectedId: '', records: [], cleanup: [] }
it('checks the persisted registry after reset even when UI rows are empty', () => {
  const { device } = pool({ ...empty, selectedId: 'sample', records: [{ id: 'sample' }] })
  expect(() => device.assertTokenStateReset()).toThrow('left connection records')
})
it.each([null, { ...empty, cleanup: [{ id: 'sample' }] }, { ...empty, selectedId: 'sample' }])(
  'rejects missing state and unfinished credential cleanup',
  (registry) => {
    expect(() => pool(registry).device.assertTokenStateReset()).toThrow('left connection records')
  }
)
it('rejects a retained runtime record or review after durable cleanup', () => {
  expect(() => pool(empty, [{ id: 'sample' }]).device.assertTokenStateReset()).toThrow(
    'live connection or review state'
  )
  expect(() =>
    pool(empty, [], [{ path: 'Scripts/sample.js' }]).device.assertTokenStateReset()
  ).toThrow('live connection or review state')
})
it('allows a fully disconnected retired fixture', () => {
  const { device, run } = pool(empty)
  expect(() => device.assertTokenStateReset()).not.toThrow()
  expect(run.mock.calls[0][1]).toBe(true)
})
