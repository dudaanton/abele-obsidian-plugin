import { expect, it } from 'vitest'
import { groupNotSynced, type NotSyncedItem } from '@/sync/notSynced'
import { connectionLine, connectionTone } from '@/sync/connectionLine'
import { DISCONNECTED_STATUS, statusText, statusWarns } from '@/sync/status'

const item: NotSyncedItem = {
  path: 'sample.bin',
  kind: 'held',
  direction: 'in',
  since: '2026-01-01T00:00:00Z',
}
it('formats large connection and status counts while keeping singular selection', () => {
  const count = 1243
  const expected = `${count.toLocaleString()} files not synced`
  expect(
    connectionLine({ status: 'idle', paused: false }, { notSynced: Array(count).fill(item) })
  ).toBe(expected)
  expect(statusText({ ...DISCONNECTED_STATUS, state: 'idle', notSynced: count })).toBe(expected)
})
it('groups reasons once and keeps safety and server retry separate from names and sizes', () => {
  const groups = groupNotSynced([
    item,
    { ...item, path: 'large.bin', kind: 'too-large' },
    { ...item, path: 'other.md', kind: 'server' },
  ])
  expect(groups.map((group) => [group.kind, group.retry])).toEqual([
    ['held', true],
    ['server', true],
    ['too-large', false],
  ])
  expect(groups.flatMap((group) => group.items)).toHaveLength(3)
})
it('does not say synced while a path is held or the list is unreadable', () => {
  const row = { status: 'idle' as const, paused: false }
  expect(connectionLine(row, { notSynced: [item] })).toContain('1 file not synced')
  expect(connectionTone(row, { notSynced: [item] })).toBe('orange')
  expect(connectionLine(row, { notSyncedError: true })).not.toContain('Synced')
  const status = { ...DISCONNECTED_STATUS, state: 'idle' as const, notSynced: 1 }
  expect(statusText(status)).toBe('1 file not synced')
  expect(statusWarns(status)).toBe(true)
})
it('does not claim settled sync while the first durable list is still being read', () => {
  expect(
    connectionLine(
      { status: 'idle', paused: false },
      { lastSync: Date.now(), notSyncedLoading: true }
    )
  ).toBe('Checking the vault')
  expect(statusText({ ...DISCONNECTED_STATUS, state: 'idle', notSyncedLoading: true })).not.toBe(
    'Synced'
  )
})
