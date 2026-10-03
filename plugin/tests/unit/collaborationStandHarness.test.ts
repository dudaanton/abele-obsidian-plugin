// @vitest-environment node
import { it, expect } from 'vitest'
import { assembleDisposableCollaborationApp } from '../e2e/helpers/collaborationStandHarness'
it('enables group contracts only in an exact owned disposable assembly with actual certified worker calls', () => {
  const source = 'registerScopedFence(app);\nregisterCapabilityRoutes(app);',
    built = assembleDisposableCollaborationApp(source)
  expect(built).toContain('group:true')
  expect(built).toContain('prepareGroupBootstrap')
  expect(built).toContain('processGroupDirtyPage')
  expect(built).toContain('x-disposable-owner')
  expect(() => assembleDisposableCollaborationApp('different source')).toThrow(/assembly/)
})
