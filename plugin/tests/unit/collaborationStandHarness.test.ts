// @vitest-environment node
import { it, expect } from 'vitest'
import { agentStandStartScript, standPreparationPath } from '../e2e/helpers/agentStandHarness'
it('uses the deployable group worker and real owner preparation instead of a disposable assembly', () => {
  const built = agentStandStartScript('/sample/verified-archive')
  expect(built).toContain('ABELE_SCOPED_SHARING')
  expect(standPreparationPath('sample-vault', 'sample-grant')).toBe(
    '/v1/vaults/sample-vault/grants/sample-grant/prepare'
  )
  expect(standPreparationPath('sample-vault')).toBe('/v1/vaults/sample-vault/grants/groups/prepare')
  expect(built).not.toContain('x-disposable-owner')
  expect(() => agentStandStartScript('different source')).toThrow(/archive/)
})
