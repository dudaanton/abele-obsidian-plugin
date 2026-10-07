import { expect, it } from 'vitest'
import { ManagedSettingsValue } from '@/services/managedSettingsValue'

const original = { ciphertext: 'sample-old', key: { salt: 'sample-old-salt' } }
const changed = { ciphertext: 'sample-new', key: { salt: 'sample-new-salt' } }

it.each(['read first', 'request first', 'IO first'] as const)(
  'protects an atomic value across every save/read ordering (%s)',
  (ordering) => {
    const value = new ManagedSettingsValue()
    value.beginWrite(original)()
    let read: object | null
    let written: () => void
    if (ordering === 'read first') read = value.beginRead()
    value.request(changed)
    if (ordering === 'request first') read = value.beginRead()
    written = value.beginWrite(changed)
    if (ordering === 'IO first') read = value.beginRead()
    expect(value.retain(read!)?.value).toEqual(changed)
    written()
    expect(value.protects(read!)).toBe(true)
    expect(value.retain(read!)?.value).toEqual(changed)
    const after = value.beginRead()
    expect(value.protects(after)).toBe(false)
    expect(value.retain(after)).toBeNull()
  }
)

it('fences an overlapping read with the actual written value, not an older local request', () => {
  const value = new ManagedSettingsValue()
  value.request(original)
  value.beginWrite(original)()
  const read = value.beginRead()
  value.beginWrite(changed)() // A normal settings save after taking in another device's store.
  expect(value.retain(read)?.value).toEqual(changed)
})

it('does not retire a newer queued request when an earlier write is acknowledged', () => {
  const value = new ManagedSettingsValue()
  value.request(original)
  const written = value.beginWrite(original)
  const read = value.beginRead()
  value.request(changed)
  written()
  expect(value.retain(read)?.value).toEqual(changed)
  const later = value.beginWrite(changed)
  later()
  const latest = value.beginRead()
  written() // Duplicate acknowledgment cannot revive the earlier snapshot.
  expect(value.beginRead()).toBe(latest)
  expect(value.retain(latest)).toBeNull()
})

it('retains failed/unacknowledged requests and captures their whole value by copy', () => {
  const value = new ManagedSettingsValue()
  const mutable = structuredClone(changed)
  const read = value.beginRead()
  value.request(mutable)
  value.beginWrite(mutable) // IO failed: no receipt.
  mutable.key.salt = 'sample-mutated-salt'
  const retained = value.retain(read)!
  expect(retained.value).toEqual(changed)
  ;(retained.value as typeof changed).key.salt = 'sample-other-salt'
  expect(value.retain(read)?.value).toEqual(changed)
})

it('protects an accepted no-op and an atomic removal without leaf patches', () => {
  const value = new ManagedSettingsValue()
  value.beginWrite(original)()
  const read = value.beginRead()
  value.beginWrite(original)()
  expect(value.retain(read)?.value).toEqual(original)
  value.request(undefined)
  const removal = value.beginWrite(undefined)
  const during = value.beginRead()
  removal()
  expect(value.retain(during)).toEqual({ value: undefined })
})
