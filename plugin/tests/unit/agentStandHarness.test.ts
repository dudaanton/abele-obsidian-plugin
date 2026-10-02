// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  assembleDisposableAgentApp,
  assertAgentStage,
  assertAgentCredential,
  requireAgentImageGate,
} from '../e2e/helpers/agentStandHarness'
describe('agent stand fixture authority and pending gates', () => {
  it('refuses invalid opt-in before mutation', () => {
    expect(() => assertAgentStage('bad')).toThrow(/stage/)
    expect(() => assertAgentStage(undefined)).toThrow(/stage/)
  })
  it('never gives an agent a personal/account secret', () => {
    for (const p of ['abst_', 'absd_', 'absi_'])
      expect(() => assertAgentCredential(p + 'a'.repeat(43))).toThrow(/scoped machine/)
    expect(() => assertAgentCredential('absk_' + 'a'.repeat(43))).not.toThrow()
  })
  it('requires the exact expected two dormant hooks rather than silently changing any server assembly', () => {
    expect(() => assembleDisposableAgentApp('unexpected app code')).toThrow(/assembly/)
    const code = 'registerScopedFence(app);\nregisterCapabilityRoutes(app);'
    const built = assembleDisposableAgentApp(code)
    expect(built).not.toContain('registerScopedFence(app);')
    expect(built).toContain('test fixture contract only')
  })
  it.each(['owner-extras', 'native-image'])(
    'pending %s is a failed assertion, never a passed/skipped gate',
    (step) => {
      expect(() => requireAgentImageGate(step)).toThrow(/PENDING/)
    }
  )
})
