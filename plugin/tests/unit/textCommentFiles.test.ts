import { describe, it, expect } from 'vitest'
import type { App } from 'obsidian'
import { collectMediaReferences } from '@/helpers/mediaReferences'
import { buildFakeVault } from '../helpers/fakeVault'
import { guardChatWrite } from '@/ai/tools/chatWriteGuard'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { GlobalStore } from '@/stores/GlobalStore'

describe('human comment system files', () => {
  it('does not enumerate human thread files as ordinary scoped notes', () => {
    const app = buildFakeVault([{ path: 'Notes/sample.md' }, { path: 'System/aaaaaa.abcomment' }])
    ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = app
    const scope = new ScopeResolver()
    scope.addFolder('System')
    expect(scope.getAccessiblePaths()).not.toContain('System/aaaaaa.abcomment')
    scope.setFullVaultAccess(true)
    expect(scope.getAccessiblePaths()).not.toContain('System/aaaaaa.abcomment')
    expect(scope.getAccessiblePaths()).toContain('Notes/sample.md')
    scope.destroy()
  })
  it('protects media referenced only inside a comment body from cleanup', async () => {
    const app = buildFakeVault([
      {
        path: 'System/aaaaaa.abcomment',
        content: JSON.stringify({ entries: [{ body: '![[sample-image.png]]' }] }),
      },
      { path: 'sample-image.png', content: '' },
    ]) as unknown as App
    delete app.metadataCache.resolvedLinks['System/aaaaaa.abcomment']
    expect(await collectMediaReferences(app)).toContain('sample-image.png')
  })
  it('keeps the single comment writer boundary in file tools', () => {
    expect(() => guardChatWrite('System/aaaaaa.abcomment')).toThrow('comment')
    expect(() => guardChatWrite('Notes/sample.md')).not.toThrow()
  })
})
