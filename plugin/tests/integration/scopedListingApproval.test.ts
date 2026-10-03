import { beforeEach, describe, expect, it } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { createLsTool } from '@/ai/tools/LsTool'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

let session: ChatSession
const listed = async (path?: string) => {
  const result = await createLsTool().execute(
    'sample-list',
    path === undefined ? {} : { path },
    undefined,
    {
      scope: session.scopeResolver,
    }
  )
  return result.content.map((part) => part.text).join('\n')
}

destroyChatsAfterEach()
beforeEach(() => {
  useVault([
    { path: 'Sample/Nested/visible.md' },
    { path: 'Sample/Nested/hidden.md' },
    { path: 'Sample/hidden.md' },
    { path: 'Unrelated/hidden.md' },
    { path: 'hidden-root.md' },
  ])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  session = new ChatSession(ChatService.getInstance())
  session.permissionMode.value = 'confirm-all'
  session.scopeResolver.clear()
  session.scopeResolver.addFile('Sample/Nested/visible.md')
})

describe('scope-filtered directory listing', () => {
  it.each([undefined, '', '/', 'Sample', 'Sample/', 'Sample/Nested'])(
    'lists %s without asking or exposing siblings',
    async (path) => {
      expect(session.needsApproval('ls', path === undefined ? {} : { path })).toBe(false)
      const text = await listed(path)
      expect(text).toBe(
        !path || path === '/'
          ? 'Sample/'
          : path.replace(/\/$/, '') === 'Sample'
            ? 'Nested/'
            : 'visible.md'
      )
      expect(session.scopeResolver.entries.value).toEqual([
        { type: 'file', path: 'Sample/Nested/visible.md' },
      ])
    }
  )

  it('refuses unrelated folders at the tool boundary without asking to extend scope', async () => {
    expect(session.needsApproval('ls', { path: 'Unrelated' })).toBe(false)
    await expect(listed('Unrelated')).rejects.toThrow('Access denied')
    expect(session.needsApproval('read', { path: 'Sample/Nested/hidden.md' })).toBe(true)
    expect(session.needsApproval('write', { path: 'Sample/Nested/hidden.md' })).toBe(true)
  })

  it.each([undefined, '', '/'])('returns an empty scope for root %s', async (path) => {
    session.scopeResolver.clear()
    expect(session.needsApproval('ls', path === undefined ? {} : { path })).toBe(false)
    expect(await listed(path)).toBe('(empty scope)')
  })

  it('keeps a delegated ceiling even when its own scope claims the full vault', async () => {
    const ceiling = new ScopeResolver()
    ceiling.addFile('Sample/Nested/visible.md')
    session.scopeResolver.setCeiling(ceiling)
    session.scopeResolver.setFullVaultAccess(true)
    expect(session.needsApproval('ls', { path: 'Sample' })).toBe(false)
    expect(await listed('/')).toBe('Sample/')
    expect(await listed('Sample/Nested')).toBe('visible.md')
    await expect(listed('Unrelated')).rejects.toThrow('Access denied')
    expect(session.needsApproval('read', { path: 'Sample/Nested/hidden.md' })).toBe(true)
    ceiling.destroy()
  })
})
