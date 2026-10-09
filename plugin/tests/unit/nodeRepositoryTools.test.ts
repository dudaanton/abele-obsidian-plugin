import { expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createNodeTools, NodeRepositoryToolsHost } from '@/ai/tools/node'
import type { ChatSession } from '@/ai/ChatSession'
import type { RepositorySource } from '@/repository/source'
import type { ToolContext } from '@/ai/toolContext'

it('requires a chat/project grant and rechecks it before publication and continuations', async () => {
  const session = {} as ChatSession
  const host = new NodeRepositoryToolsHost()
  const source = {
    identity: { provider: 'node', installation: 'i', node: 'n', project: 'p', workspace: 'w' },
    cacheNamespace: 'generation',
    assertCurrent: vi.fn(),
    text: vi.fn(async () => '🙂'.repeat(20000)),
  } as unknown as RepositorySource
  host.attach({ source, selection: () => ({ text: 'secret' }), open: vi.fn() })
  const tools = createNodeTools(host)
  const call = (name: string, params: Record<string, unknown> = {}, chat = session) =>
    tools
      .find((t) => t.name === name)!
      .execute('id', { node: 'n', project: 'p', workspace: 'w', ...params }, undefined, {
        session: chat,
      } as ToolContext)
  await expect(call('node_file', { path: 'a', chat: session })).rejects.toThrow(/grant/i)
  expect(source.text).not.toHaveBeenCalled()
  expect(JSON.stringify(await call('node_views'))).not.toContain('secret')
  host.grant(session, 'n', 'p')
  const result = await call('node_file', { path: 'a' })
  expect(new TextEncoder().encode(result.content[0].text).length).toBeLessThanOrEqual(32768)
  expect(result.content[0].text).toContain('omitted')
  let cursor = (result.details as { cursor: string }).cursor
  expect(cursor).toBeTruthy()
  const rebuilt = createNodeTools(host).find((t) => t.name === 'node_file')!
  const resumed = await rebuilt.execute('rebuilt', { cursor }, undefined, {
    session,
  } as ToolContext)
  expect(resumed.content[0].text).toContain('🙂')
  cursor = (resumed.details as { cursor: string }).cursor
  await expect(call('node_file', { cursor }, {} as ChatSession)).rejects.toThrow()
  expect((await call('node_file', { cursor })).content[0].text).toContain('🙂')
  host.revoke(session, 'n', 'p')
  await expect(call('node_file', { cursor })).rejects.toThrow()
  host.grant(session, 'n', 'p')
  vi.mocked(source.text).mockImplementation(async () => {
    host.revoke(session, 'n', 'p')
    host.grant(session, 'n', 'p')
    return 'secret'
  })
  await expect(call('node_file', { path: 'a' })).rejects.toThrow(/grant/i)
})

it('documents all node tools', () => {
  const docs = readFileSync('src/docs/tools.md', 'utf8')
  for (const tool of createNodeTools()) expect(docs).toContain(tool.name)
})

it('reads file lines through a fake node repository client and bounds serialized control characters', async () => {
  const session = {} as ChatSession
  const client = {
    repository: {
      blob: vi.fn(async (_request: { worktree_id: string; path: string }) => ({
        content_id: 'retained',
      })),
      content: vi.fn(async (_request: { worktree_id: string; content_id: string }) => ({
        text: 'first\nsecond\nthird',
      })),
    },
  }
  const host = new NodeRepositoryToolsHost()
  const source = {
    identity: { provider: 'node', installation: 'i', node: 'n', project: 'p', workspace: 'w' },
    cacheNamespace: 'g',
    assertCurrent: vi.fn(),
    text: async (_ref: string, path: string) => {
      const blob = await client.repository.blob({ worktree_id: 'w', path })
      return (await client.repository.content({ worktree_id: 'w', content_id: blob.content_id }))
        .text
    },
  } as unknown as RepositorySource
  host.attach({ source, selection: () => null, open: vi.fn() })
  host.grant(session, 'n', 'p')
  const tool = createNodeTools(host).find((t) => t.name === 'node_file')!
  const ctx = { session } as ToolContext
  const params = { node: 'n', project: 'p', workspace: 'w', path: 'a' }
  expect(
    (await tool.execute('id', { ...params, start_line: 2, end_line: 2 }, undefined, ctx)).content[0]
      .text
  ).toBe('second')
  expect(client.repository.content).toHaveBeenCalledWith({
    worktree_id: 'w',
    content_id: 'retained',
  })
  client.repository.content.mockResolvedValue({ text: '\u0001'.repeat(40000) })
  const result = await tool.execute('id', params, undefined, ctx)
  expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(32768)
})

it('accepts only a separate interactive owner approval and rejects conversation changes while waiting', async () => {
  const session = { conversationVersion: { value: 0 } } as ChatSession
  const host = new NodeRepositoryToolsHost()
  const source = {
    identity: { provider: 'node', installation: 'i', node: 'n', project: 'p', workspace: 'w' },
    cacheNamespace: 'g',
    assertCurrent: vi.fn(),
    text: vi.fn(async () => 'code'),
  } as unknown as RepositorySource
  host.attach({ source, selection: () => null, open: vi.fn() })
  const approve = vi.fn(async () => true)
  const tool = createNodeTools(host, approve).find((t) => t.name === 'node_file')!
  const params = { node: 'n', project: 'p', workspace: 'w', path: 'a' }
  await expect(
    tool.execute('id', params, undefined, {
      session,
      interactive: false,
      approved: true,
    } as ToolContext)
  ).rejects.toThrow(/grant/i)
  expect(approve).not.toHaveBeenCalled()
  await tool.execute('id', params, undefined, { session, interactive: true } as ToolContext)
  expect(approve).toHaveBeenCalledOnce()
  host.revokeAll(session)
  approve.mockImplementation(async () => {
    session.conversationVersion.value++
    return true
  })
  await expect(
    tool.execute('id', params, undefined, { session, interactive: true } as ToolContext)
  ).rejects.toThrow(/changed/i)
})

it('retires grants when the session loads a different conversation or installation changes', async () => {
  const session = { conversationVersion: { value: 0 } } as ChatSession
  const host = new NodeRepositoryToolsHost()
  const source = {
    identity: { provider: 'node', installation: 'i', node: 'n', project: 'p', workspace: 'w' },
    cacheNamespace: 'generation',
    assertCurrent: vi.fn(),
    text: vi.fn(async () => 'secret'),
  } as unknown as RepositorySource
  const tab = { source, selection: () => null, open: vi.fn() }
  host.attach(tab)
  host.grant(session, 'n', 'p')
  const check = host.guard(session, tab)
  session.conversationVersion.value++
  expect(check).toThrow(/grant/i)
  expect(() => host.guard(session, tab)).toThrow(/grant/i)
  host.grant(session, 'n', 'p')
  host.guard(session, tab)()
  const changed = { ...source, cacheNamespace: 'new-owner-generation' }
  const replacementTab = { ...tab, source: changed }
  host.attach(replacementTab)
  expect(() => host.guard(session, replacementTab)).toThrow(/grant/i)
  if (source.identity.provider === 'node') source.identity.installation = 'replacement'
  expect(() => host.guard(session, tab)).toThrow(/grant/i)
})

it('mirrors repository reads, external workspaces, patches, searches and shared navigation', async () => {
  const session = {} as ChatSession
  const host = new NodeRepositoryToolsHost()
  const source = {
    identity: { provider: 'node', installation: 'i', node: 'n', project: 'p', workspace: 'w' },
    cacheNamespace: 'generation',
    assertCurrent: vi.fn(),
    home: vi.fn(async () => ({ meta: {} })),
    workspaces: vi.fn(async () => [{ id: 'orca', readOnly: true }]),
    folder: vi.fn(async () => ({ entries: [] })),
    text: vi.fn(async () => 'code'),
    status: vi.fn(async () => ({ files: [] })),
    compare: vi.fn(async () => ({ files: [], note: 'limited coverage' })),
    comparison: vi.fn(async () => ({ changes: [] })),
    comparisonFile: vi.fn(async () => ({ note: 'binary' })),
    commits: vi.fn(async () => []),
    commit: vi.fn(async () => ({ sha: 'sha' })),
    search: vi.fn(async () => ({ capped: true, note: 'scan incomplete' })),
    blame: vi.fn(async () => []),
  } as unknown as RepositorySource
  const open = vi.fn()
  host.attach({ source, selection: () => ({ text: 'selected' }), open })
  host.grant(session, 'n', 'p')
  const tools = createNodeTools(host)
  const call = (name: string, params: Record<string, unknown> = {}) =>
    tools
      .find((t) => t.name === name)!
      .execute('id', { node: 'n', project: 'p', workspace: 'w', ...params }, undefined, {
        session,
      } as ToolContext)
  expect((await call('list_node_worktrees')).content[0].text).toContain('orca')
  for (const name of [
    'node_read',
    'node_tree',
    'node_file',
    'node_changes',
    'node_commits',
    'node_commit',
    'node_compare',
    'node_search',
    'node_grep',
    'node_blame',
  ])
    await call(name, { revision: 'HEAD', path: 'a', query: 'code' })
  expect(source.comparisonFile).toHaveBeenCalled()
  expect(source.search).toHaveBeenCalledWith(
    expect.objectContaining({ scope: 'repo', ref: 'HEAD' })
  )
  await call('node_search', { mode: 'path', query: '*.ts' })
  expect(source.search).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'names' }))
  await call('node_open', { commit: 'abc', path: 'a', start_line: 2, end_line: 3 })
  expect(open).toHaveBeenCalledWith(
    'n',
    'p',
    'w',
    'a',
    expect.objectContaining({ commit: 'abc', lines: { start: 2, end: 3 } })
  )
  for (const path of ['../secret', '/secret', '.git/config', 'x/.GIT/config', 'C:/secret'])
    await expect(call('node_file', { path })).rejects.toThrow(/path/i)
})
