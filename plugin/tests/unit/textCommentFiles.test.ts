import { describe, it, expect } from 'vitest'
import type { App } from 'obsidian'
import { collectMediaReferences } from '@/helpers/mediaReferences'
import { buildFakeVault } from '../helpers/fakeVault'
import { guardChatWrite } from '@/ai/tools/chatWriteGuard'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { GlobalStore } from '@/stores/GlobalStore'
import { encodeThread } from '@/comments/model'

const comment = (body: string) =>
  encodeThread({
    version: 1,
    id: 'aaaaaa',
    anchor: { note: 'Notes/Nested/sample.md', quote: 'sample words' },
    appearance: 'yellow',
    entries: [{ id: 'bbbbbb', body, createdAt: '2025-01-02T03:04:05.000Z' }],
  })

describe('human comment system files', () => {
  it('protects relative images beside a nested anchor note, not beside the system thread', async () => {
    const app = buildFakeVault([
      { path: 'Notes/Nested/sample.md' },
      { path: 'Notes/Nested/assets/sample.png' },
      { path: 'System/Comments/assets/sample.png' },
      { path: 'System/Comments/aaaaaa.abcomment', content: comment('![](./assets/sample.png)') },
    ]) as unknown as App
    const resolve = app.metadataCache.getFirstLinkpathDest.bind(app.metadataCache)
    app.metadataCache.getFirstLinkpathDest = (target, source) =>
      target.startsWith('./')
        ? app.vault.getFileByPath(source.slice(0, source.lastIndexOf('/')) + '/' + target.slice(2))
        : resolve(target, source)
    delete app.metadataCache.resolvedLinks['System/Comments/aaaaaa.abcomment']
    const references = await collectMediaReferences(app)
    expect(references).toContain('Notes/Nested/assets/sample.png')
    expect(references).not.toContain('System/Comments/assets/sample.png')
  })
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
        content: comment('![[sample-image.png]]'),
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
