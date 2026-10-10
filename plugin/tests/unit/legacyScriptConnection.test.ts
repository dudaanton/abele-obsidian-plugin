import { describe, expect, it } from 'vitest'
import { buildFakeVault } from '../helpers/fakeVault'
import { assertCurrentScriptConnection } from '@/scripting/trust/scriptConnection'
import { CONNECTION_KEY, inspectConnection } from '@/sync/connection'

const binding = {
  localVault: 'sample-local',
  endpoint: 'https://sync.example',
  vaultId: 'sample-vault',
  principal: 'sample-device',
  facet: 'personal' as const,
  grantId: null,
}
function legacy() {
  const app = buildFakeVault([])
  app.saveLocalStorage(CONNECTION_KEY, {
    serverUrl: binding.endpoint,
    vaultId: binding.vaultId,
    deviceId: binding.principal,
    deviceTokenId: 'abele-sync-device-sample',
    migrated: true,
  })
  return app
}
describe('script connection legacy normalization', () => {
  it('accepts the same supported missing enrolledUrl record as normal connection inspection', () => {
    const app = legacy()
    const current = inspectConnection(app)
    expect(current.damaged).toEqual([])
    expect(current.connection.enrolledUrl).toBe(binding.endpoint)
    expect(() => assertCurrentScriptConnection(app, binding)).not.toThrow()
    expect((app.loadLocalStorage(CONNECTION_KEY) as any).enrolledUrl).toBeUndefined()
  })
  it.each([null, 17, 'https://other.example'])(
    'never treats an explicit malformed/different enrolledUrl %s as legacy absence',
    (enrolledUrl) => {
      const app = legacy()
      app.saveLocalStorage(CONNECTION_KEY, {
        ...(app.loadLocalStorage(CONNECTION_KEY) as object),
        enrolledUrl,
      })
      expect(() => assertCurrentScriptConnection(app, binding)).toThrow(/changed/)
    }
  )
})
