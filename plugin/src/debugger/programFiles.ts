import type { NodeClient } from '@abele/node-client'
import type { PathTarget } from '@/node/NodePathModel'

const ENTRY = /\.[cm]?[jt]s$/

/** Filename search is read by page; an open entry keeps its place at the top. */
export async function programFiles(
  client: NodeClient,
  target: PathTarget,
  open: string[]
): Promise<string[]> {
  const files = new Set(open.filter((path) => ENTRY.test(path)))
  const revision =
    target.kind === 'worktree'
      ? (await client.repository.observe({ worktree_id: target.id })).revision
      : undefined
  let cursor: string | undefined
  do {
    const params = {
      query: '.',
      mode: 'filename' as const,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    }
    const page =
      target.kind === 'worktree' && revision
        ? await client.repository.search({ ...params, worktree_id: target.id, revision })
        : await client.nodePath.search({ ...params, workspace_id: target.id })
    for (const entry of page.entries) if (ENTRY.test(entry.path)) files.add(entry.path)
    cursor = page.cursor ?? undefined
  } while (cursor)
  return [...files]
}
