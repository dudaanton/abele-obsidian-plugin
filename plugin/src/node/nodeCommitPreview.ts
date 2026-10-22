import { z } from 'zod'
import type { ChatSession } from '@/ai/ChatSession'
import type { AgentTool } from '@/ai/client'

const Comparison = z.object({
  head: z.object({ kind: z.literal('working'), head: z.string().nullable() }),
  entries: z.array(z.object({ path: z.string() })),
  incomplete: z.boolean().optional(),
  patch: z.string().optional(),
})

/** Owner-side inspection uses the same read scope and authority fences as ordinary Git reads. */
export async function nodeCommitPreview(
  session: ChatSession,
  params: Record<string, unknown>,
  tools?: AgentTool[],
  signal?: AbortSignal,
  listed?: (preview: { files: { path: string; patch: string; error?: string }[] }) => void
): Promise<{ files: { path: string; patch: string; error?: string }[] }> {
  const available = tools ?? (await import('@/ai/tools/node')).createNodeTools()
  const tool = available.find((entry) => entry.name === 'node_git_diff')!
  const target = Object.fromEntries(
    ['node', 'project', 'workspace', 'target_kind']
      .filter((key) => params[key] !== undefined)
      .map((key) => [key, params[key]])
  )
  const read = async (path?: string) => {
    let next: Record<string, unknown> = { ...target, mode: 'staged', ...(path ? { path } : {}) }
    let text = ''
    for (let page = 0; page < 100; page++) {
      const result = await tool.execute('owner-commit-preview', next, signal, {
        session,
        scope: session.scopeResolver,
        interactive: true,
        approved: false,
      })
      text += result.content
        .map((part) => part.text)
        .join('')
        .split('\n\nResult continues. Call ')[0]
      if (text.length > 2 * 1024 * 1024) throw new Error('record_too_large')
      const cursor = (result.details as { cursor?: string } | undefined)?.cursor
      if (!cursor) {
        const comparison = Comparison.parse(JSON.parse(text))
        if (comparison.head.head !== params.expected_head) throw new Error('stale_resource')
        if (comparison.incomplete) throw new Error('record_too_large')
        return comparison
      }
      next = { cursor }
    }
    throw new Error('record_too_large')
  }
  const comparison = await read()
  listed?.({ files: comparison.entries.map(({ path }) => ({ path, patch: '' })) })
  const files: { path: string; patch: string; error?: string }[] = []
  for (const entry of comparison.entries) {
    try {
      const detail = await read(entry.path)
      files.push({ path: entry.path, patch: detail.patch ?? '' })
    } catch (error) {
      signal?.throwIfAborted()
      if (error instanceof Error && error.message === 'stale_resource') throw error
      files.push({
        path: entry.path,
        patch: '',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { files }
}
