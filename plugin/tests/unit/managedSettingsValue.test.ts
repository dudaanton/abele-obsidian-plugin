import { expect, it } from 'vitest'
import { ManagedSettingsValue } from '@/services/managedSettingsValue'

const original = { ciphertext: 'sample-old', key: { salt: 'sample-old-salt' } }
const changed = { ciphertext: 'sample-new', key: { salt: 'sample-new-salt' } }

it.each(['read first', 'request first', 'IO first'] as const)(
  'retains queued atomic intent until its serialized write succeeds (%s)',
  (ordering) => {
    const value = new ManagedSettingsValue()
    if (ordering === 'read first') expect(value.retain()).toBeNull()
    value.request(changed)
    if (ordering === 'request first') expect(value.retain()?.value).toEqual(changed)
    const written = value.beginWrite()
    if (ordering === 'IO first') expect(value.retain()?.value).toEqual(changed)
    expect(value.protects()).toBe(true)
    expect(value.retain()?.value).toEqual(changed)
    written()
    // The queue forbids old reads crossing this write. Never pin a completed value
    // over a genuinely newer external file read by the next queue item.
    expect(value.protects()).toBe(false)
    expect(value.retain()).toBeNull()
  }
)

it('never retains a completed local value over a later external read', () => {
  const value = new ManagedSettingsValue()
  value.request(original)
  value.beginWrite()()
  expect(value.retain()).toBeNull()
  value.beginWrite()() // Ordinary save/no-op: it creates no identity or replacement value.
  expect(value.retain()).toBeNull()
})

it('does not retire a newer queued request when an earlier write is acknowledged', () => {
  const value = new ManagedSettingsValue()
  value.request(original)
  const written = value.beginWrite()
  value.request(changed)
  written()
  expect(value.retain()?.value).toEqual(changed)
  value.beginWrite()()
  written() // Duplicate acknowledgment cannot revive the earlier snapshot.
  expect(value.retain()).toBeNull()
})

it('retains failed/unacknowledged requests and captures their whole value by copy', () => {
  const value = new ManagedSettingsValue()
  const mutable = structuredClone(changed)
  value.request(mutable)
  value.beginWrite() // IO failed: no receipt.
  mutable.key.salt = 'sample-mutated-salt'
  const retained = value.retain()!
  expect(retained.value).toEqual(changed)
  ;(retained.value as typeof changed).key.salt = 'sample-other-salt'
  expect(value.retain()?.value).toEqual(changed)
})

it('acknowledges an accepted no-op and an atomic removal without leaf patches', () => {
  const value = new ManagedSettingsValue()
  value.request(original)
  expect(value.retain()?.value).toEqual(original)
  value.beginWrite()()
  expect(value.retain()).toBeNull()
  value.request(undefined)
  expect(value.retain()).toEqual({ value: undefined })
  const removal = value.beginWrite()
  removal()
  expect(value.retain()).toBeNull()
})
