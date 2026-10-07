import { expect, it } from 'vitest'
import { scopedSecretSlot, scopedSecretPort } from '@/sync/scoped/scopedSecretSlots'

const uuid = '12345678-1234-4234-8234-123456789abc'
it('keeps every scoped credential and proof within the Obsidian alphabet and length', () => {
  const ids = ['invitation', 'installation'].flatMap((kind) =>
    ['', ':binding', ':accepted'].map((suffix) => `abele-scoped-${kind}-${uuid}${suffix}`)
  )
  const slots = ids.map(scopedSecretSlot)
  for (const slot of slots) expect(slot).toMatch(/^[a-z0-9-]{1,64}$/)
  expect(new Set(slots).size).toBe(ids.length)
})
it('reads old proof slots without rebinding their stored connection identity', () => {
  const logical = `abele-scoped-installation-${uuid}:binding`
  const old = logical.replaceAll(':', '-')
  const values = new Map([[old, 'original-proof']])
  const port = scopedSecretPort({
    getLocal: (id) => values.get(id) ?? '',
    setLocal: (id, value) => {
      values.set(id, value)
    },
  })
  expect(port.get(logical)).toBe('original-proof')
  port.set(logical, 'new-proof')
  expect(values.get(scopedSecretSlot(logical))).toBe('new-proof')
  expect(port.get(logical)).toBe('new-proof')
})
it('does not attempt an invalid legacy lookup when a strict keychain rejects it', () => {
  const port = scopedSecretPort({
    getLocal: (id) => {
      if (!/^[a-z0-9-]{1,64}$/.test(id)) throw new Error('Invalid ID')
      return ''
    },
    setLocal: () => {},
  })
  expect(port.get(`abele-scoped-invitation-${uuid}:binding`)).toBe('')
})
