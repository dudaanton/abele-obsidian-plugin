import type { NodeClient } from '@abele/node-client'
import type { PathTarget } from './NodePathModel'
import { readNodeText } from './NodeFilesModel'

/** A query's snippets share one observation and never load large or binary file bodies. */
export function referencePreviewReader(client: NodeClient, target: PathTarget) {
  const limit = 512 * 1024
  let revision: ReturnType<NodeClient['repository']['observe']> | undefined
  return async (path: string): Promise<string> => {
    if (target.kind === 'worktree') {
      revision ??= client.repository.observe({ worktree_id: target.id })
      const { revision: observed } = await revision
      const blob = await client.repository.blob({
        worktree_id: target.id,
        revision: observed,
        path,
      })
      if (!blob.content_id || blob.binary || blob.size > limit) return ''
      return readNodeText(
        (offset) =>
          client.repository.content({
            worktree_id: target.id,
            content_id: blob.content_id,
            offset,
          }),
        limit
      )
    }
    const file = await client.readFile(target.id, path)
    if (!file.content_id || file.binary || file.size > limit) return ''
    return readNodeText((offset) => client.readContent(target.id, file.content_id, offset), limit)
  }
}
