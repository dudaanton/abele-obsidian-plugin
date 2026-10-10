import { expect, it, vi } from 'vitest'
import { createNodeTools, NodeRepositoryToolsHost } from '@/ai/tools/node'
import type { ChatSession } from '@/ai/ChatSession'
import type { RepositorySource } from '@/repository/source'
import type { ToolContext } from '@/ai/toolContext'
function fixture() {
  const session = {
    conversationVersion: { value: 0 },
    branchSelectionVersion: 0,
  } as unknown as ChatSession
  const host = new NodeRepositoryToolsHost(),
    proposeEdit = vi.fn(async (_proposal, guard) => {
      guard()
      return 'Local proposal retained; owner Save required.'
    })
  const tab = {
    source: {
      identity: { provider: 'node', installation: 'i', node: 'n', project: 'p', workspace: 'w' },
      cacheNamespace: 'source',
      assertCurrent: vi.fn(),
    } as unknown as RepositorySource,
    selection: () => null,
    open: vi.fn(),
    proposeEdit,
  }
  host.attach(tab)
  const tool = createNodeTools(host).find((t) => t.name === 'node_propose_edit')!
  const params = {
    node: 'n',
    project: 'p',
    workspace: 'w',
    path: 'sample.ts',
    expected_content_id: 'a'.repeat(64),
    text: 'proposed',
  }
  const call = (approved = false, interactive = true) =>
    tool.execute('proposal', params, undefined, { session, approved, interactive } as ToolContext)
  return { host, session, proposeEdit, params, call }
}
it('requires independent read access and per-edit interactive owner approval even when arguments claim approval', async () => {
  const f = fixture()
  await expect(f.call(true)).rejects.toThrow(/grant/i)
  f.host.grant(f.session, 'n', 'p')
  await expect(f.call()).rejects.toThrow(/per-edit/i)
  await expect(f.call(true, false)).rejects.toThrow(/per-edit/i)
  expect(f.proposeEdit).not.toHaveBeenCalled()
  expect((await f.call(true)).content[0].text).toContain('owner Save')
  expect(f.proposeEdit).toHaveBeenCalledWith(
    { path: 'sample.ts', expected_content_id: 'a'.repeat(64), text: 'proposed' },
    expect.any(Function)
  )
})
it('snapshots the approved proposal and fences branch/revocation while local admission waits', async () => {
  const f = fixture()
  f.host.grant(f.session, 'n', 'p')
  f.proposeEdit.mockImplementation(async (proposal, guard) => {
    f.params.text = 'changed after approval'
    expect(proposal.text).toBe('proposed')
    Object.defineProperty(f.session, 'branchSelectionVersion', { value: 1 })
    guard()
    return 'never'
  })
  await expect(f.call(true)).rejects.toThrow(/branch/i)
})
