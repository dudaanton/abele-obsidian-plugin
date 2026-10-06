// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  agentStandStartScript,
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
  it('uses verified production modules with the deployment switch, never rewritten server source', () => {
    expect(() => agentStandStartScript('')).toThrow(/archive/)
    const built = agentStandStartScript('/sample/verified-archive')
    expect(built).not.toContain('registerScopedFence(app);')
    expect(built).toContain('/packages/server/dist/api/app.js')
    expect(built).toContain('ABELE_SCOPED_SHARING')
    expect(built).not.toContain('/__disposable/')
  })
  it.each(['owner-extras', 'native-image'])(
    'pending %s is a failed assertion, never a passed/skipped gate',
    (step) => {
      expect(() => requireAgentImageGate(step)).toThrow(/PENDING/)
    }
  )
})
