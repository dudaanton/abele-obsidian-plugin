import { describe, expect, it } from 'vitest'
import { assertFreshStandBaseline } from '../e2e/helpers/standBaseline'
describe('stand fixture original-state preservation', () => {
  it.each([
    'abele-sync-ledger',
    'abele-sync-ledger-proof',
    'abele-sync-ledger-bootstrap',
    'abele-script-provenance',
  ])('refuses disconnected retained %s before any destructive enrollment/forget', (key) => {
    const original = { [key]: { stateId: 'sample-old-state', vaultId: 'sample-old-vault' } }
    const snapshot = JSON.stringify(original)
    expect(() => assertFreshStandBaseline(original, null, { vaultId: '' })).toThrow(
      /retained|existing/i
    )
    expect(JSON.stringify(original)).toBe(snapshot)
  })
  it('refuses an independent managed sentinel and saved revocation/token state', () => {
    expect(() => assertFreshStandBaseline({}, [], { vaultId: '' })).toThrow(/retained|existing/i)
    expect(() =>
      assertFreshStandBaseline({}, null, { vaultId: '', deviceTokenId: 'sample-secret-id' })
    ).toThrow(/retained|existing/i)
    expect(() =>
      assertFreshStandBaseline({}, null, {
        vaultId: '',
        pendingRevoke: [{ deviceId: 'sample-device' }],
      })
    ).toThrow(/retained|existing/i)
  })
  it('accepts only the exact clean legacy forgotten marker, never pending deletion or recovery evidence', () => {
    const forgotten = { 'abele-sync-ledger': { stateId: '', vaultId: '' } }
    const snapshot = JSON.stringify(forgotten)
    expect(() => assertFreshStandBaseline(forgotten, null, {})).not.toThrow()
    expect(JSON.stringify(forgotten)).toBe(snapshot)
    for (const retained of [
      { 'abele-sync-ledger-cleanup': ['sample-state'] },
      { 'abele-sync-ledger-proof': { stateId: 'sample-state', vaultId: 'sample-vault' } },
      { 'abele-sync-ledger': { stateId: '', vaultId: '', pending: true } },
      { 'abele-sync-ledger': {} },
    ])
      expect(() => assertFreshStandBaseline({ ...forgotten, ...retained }, null, {})).toThrow(
        /retained/i
      )
  })
  it('allows a truly fresh fixture without rewriting any originals', () => {
    expect(() =>
      assertFreshStandBaseline({ 'abele-sync-connection': { vaultId: '', paused: true } }, null, {
        vaultId: '',
        deviceTokenId: '',
        pendingRevoke: [],
      })
    ).not.toThrow()
  })
})
