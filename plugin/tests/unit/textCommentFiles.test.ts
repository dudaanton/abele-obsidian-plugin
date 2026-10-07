import { describe, it, expect } from 'vitest'
import type { App } from 'obsidian'
import { collectMediaReferences } from '@/helpers/mediaReferences'
import { buildFakeVault } from '../helpers/fakeVault'
import { guardChatWrite } from '@/ai/tools/chatWriteGuard'

describe('human comment system files', () => {
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
