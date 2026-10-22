import { expect, it, vi } from 'vitest'
import { nodeCommitPreview } from '@/node/nodeCommitPreview'
import type { ChatSession } from '@/ai/ChatSession'
import type { AgentTool } from '@/ai/client'

it('publishes the staged file list before slow per-file patches finish', async () => {
  const head = 'a'.repeat(40)
  let release!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const listed = vi.fn()
  const execute = vi.fn(async (_id: string, params: Record<string, unknown>) => {
    if (params.path) await waiting
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            head: { kind: 'working', head },
            entries: [{ path: 'sample.ts' }],
            patch: '',
          }),
        },
      ],
    }
  })
  const preview = nodeCommitPreview(
    {} as ChatSession,
    { expected_head: head },
    [{ name: 'node_git_diff', execute } as AgentTool],
    undefined,
    listed
  )
  await vi.waitFor(() =>
    expect(listed).toHaveBeenCalledWith({
      files: [{ path: 'sample.ts', patch: '', pending: true }],
    })
  )
  release()
  await preview
  expect(listed).toHaveBeenLastCalledWith({ files: [{ path: 'sample.ts', patch: '' }] })
})

it('reads the staged file list and patches through scoped readonly tools without committing', async () => {
  const head = 'a'.repeat(40)
  const execute = vi.fn(async (_id: string, params: Record<string, unknown>) => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          mode: 'staged',
          head: { kind: 'working', head },
          entries: [{ path: 'src/sample.ts', status: 'M' }],
          ...(params.path ? { patch: '-before\n+after' } : {}),
        }),
      },
    ],
  }))
  const owner = {} as ChatSession
  const result = await nodeCommitPreview(
    owner,
    {
      node: 'sample-node',
      project: 'sample-project',
      workspace: 'sample-worktree',
      expected_head: head,
      message: 'Sample commit',
    },
    [{ name: 'node_git_diff', execute } as AgentTool]
  )
  expect(result).toEqual({ files: [{ path: 'src/sample.ts', patch: '-before\n+after' }] })
  expect(execute).toHaveBeenCalledTimes(2)
  for (const call of execute.mock.calls)
    expect(call[1]).toMatchObject({ mode: 'staged', workspace: 'sample-worktree' })
})

it('refuses a preview from a different head', async () => {
  const execute = vi.fn(async () => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({ head: { kind: 'working', head: 'b'.repeat(40) }, entries: [] }),
      },
    ],
  }))
  await expect(
    nodeCommitPreview({} as ChatSession, { expected_head: 'a'.repeat(40) }, [
      { name: 'node_git_diff', execute } as AgentTool,
    ])
  ).rejects.toThrow('stale_resource')
})

it('retains the file list when a binary or oversized patch is unavailable', async () => {
  const head = 'a'.repeat(40)
  const execute = vi.fn(async (_id: string, params: Record<string, unknown>) => {
    if (params.path) throw new Error('file_too_large')
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            head: { kind: 'working', head },
            entries: [{ path: 'assets/sample.bin' }],
          }),
        },
      ],
    }
  })
  expect(
    await nodeCommitPreview({} as ChatSession, { expected_head: head }, [
      { name: 'node_git_diff', execute } as AgentTool,
    ])
  ).toEqual({ files: [{ path: 'assets/sample.bin', patch: '', error: 'file_too_large' }] })
})
