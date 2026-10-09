import { RepositoryClient } from '@abele/node-client'
import type { RepositoryRevision } from '@abele/node-protocol'
import type { JournalEvent } from '@abele/channel-protocol'

export const BASE = 'a'.repeat(40),
  HEAD = 'b'.repeat(40)
export const identity = {
  provider: 'node' as const,
  installation: 'installation-fixture',
  node: 'node-fixture',
  project: 'project-fixture',
  workspace: 'worktree-fixture',
}
const page = { cursor: null as string | null, incomplete: false, omissions: [] as string[] }
const metadata = (commit: string) => ({
  commit,
  parents: commit === BASE ? [] : [BASE],
  author: 'Sample author',
  email: 'sample@example.invalid',
  authored_at: '2025-01-01T00:00:00Z',
  subject: 'Update sample',
  message: 'Update sample\n',
})
export function nodeRepositoryFixture() {
  const calls: { method: string; params: any }[] = []
  const listeners = new Set<(event: JournalEvent) => void>()
  let text = 'export const answer = 42\n'
  let observation = 0
  const contents = new Map<string, string>()
  const content = (value: string) => {
    const id = `content-${contents.size}`
    contents.set(id, value)
    return {
      content_id: id,
      size: new TextEncoder().encode(value).length,
      binary: false,
      requires_larger_load: false,
      too_large: false,
    }
  }
  const files = (revision: RepositoryRevision) =>
    revision.kind === 'working' ? text : 'export const answer = 1\n'
  const request = async (method: string, params: any): Promise<unknown> => {
    calls.push({ method, params })
    switch (method) {
      case 'repository.v1.worktrees':
        return {
          ...page,
          entries: [
            {
              worktree_id: identity.workspace,
              project_id: identity.project,
              workspace_id: 'workspace-fixture',
              kind: 'root',
              path_label: 'sample-project',
              branch: 'refs/heads/main',
              detached: false,
              head: HEAD,
              availability: 'available',
              locked: false,
              prunable: false,
              dirty: true,
            },
            {
              worktree_id: 'external-fixture',
              project_id: identity.project,
              workspace_id: null,
              kind: 'external',
              path_label: 'worktrees-feature',
              branch: 'refs/heads/feature',
              detached: false,
              head: BASE,
              availability: 'available',
              locked: false,
              prunable: false,
              dirty: false,
            },
          ],
        }
      case 'repository.v1.refs':
        return {
          ...page,
          default_branch: 'main',
          entries: [
            { name: 'refs/heads/main', commit: HEAD, symbolic: null },
            { name: 'refs/heads/feature', commit: BASE, symbolic: null },
          ],
        }
      case 'repository.v1.resolve':
        return {
          kind: 'commit',
          commit: params.ref === BASE || params.ref === 'feature' ? BASE : HEAD,
        }
      case 'repository.v1.observe':
        return {
          revision: {
            kind: 'working',
            observation_id: `observation-${++observation}`,
            head: HEAD,
            observed_at: '2025-01-01T00:00:00Z',
          },
          atomic: false,
        }
      case 'repository.v1.tree':
        return {
          ...page,
          entries: params.path
            ? []
            : [
                {
                  name: 'app.ts',
                  path: 'app.ts',
                  kind: 'file',
                  oid: params.revision.kind === 'commit' ? HEAD : null,
                  size: 24,
                },
                { name: 'README.md', path: 'README.md', kind: 'file', oid: HEAD, size: 20 },
              ],
        }
      case 'repository.v1.blob':
        return content(
          params.path === 'README.md'
            ? '# Sample project\n![external](https://images.invalid/image.png)'
            : files(params.revision)
        )
      case 'repository.v1.content': {
        const value = new TextEncoder().encode(contents.get(params.content_id)!)
        const bytes = value.slice(params.offset || 0, (params.offset || 0) + 131072)
        return {
          offset: params.offset || 0,
          total: value.length,
          base64: btoa(String.fromCharCode(...bytes)),
        }
      }
      case 'repository.v1.status':
        return {
          ...page,
          entries: [
            { path: 'app.ts', index: 'M', worktree: 'M' },
            { path: 'new.txt', index: '?', worktree: '?' },
            { path: 'gone.txt', index: ' ', worktree: 'D' },
          ],
        }
      case 'repository.v1.history':
        return {
          ...page,
          entries:
            params.revision.kind === 'commit' && params.revision.commit === BASE
              ? [metadata(BASE)]
              : [metadata(HEAD), metadata(BASE)],
        }
      case 'repository.v1.commit':
        return metadata(params.revision.kind === 'commit' ? params.revision.commit : HEAD)
      case 'repository.v1.compare':
        return {
          ...page,
          comparison_id: 'comparison-fixture',
          base: params.base,
          head: params.head,
          mode: params.mode || 'endpoint',
          entries: [{ path: 'app.ts', status: 'M', index: 'M', worktree: 'M' }],
        }
      case 'repository.v1.patch':
        return content(
          'diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-export const answer = 1\n+export const answer = 42\n'
        )
      case 'repository.v1.blame':
        return {
          ...page,
          content_id: content(text).content_id,
          entries: [{ line: 1, original_line: 1, commit: null, author: 'Uncommitted', text }],
        }
      case 'repository.v1.search':
        return {
          ...page,
          incomplete: true,
          omissions: ['binary files skipped'],
          entries: [{ path: 'app.ts', line: 1, text, content_id: content(text).content_id }],
        }
      case 'repository.v1.watch':
        return {
          subscription_id: 'subscription-fixture',
          expires_at: new Date(Date.now() + 60000).toISOString(),
          refresh_required: true,
        }
      case 'repository.v1.unwatch':
        return { removed: true }
      default:
        throw new Error(`Unsupported fixture call: ${method}`)
    }
  }
  return {
    client: {
      repository: new RepositoryClient(request),
      onEvent: (listener: (event: JournalEvent) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      subscribe: async () => ({}),
      get connected() {
        return true
      },
    },
    calls,
    request,
    event(type: string, data: unknown) {
      for (const listener of listeners)
        listener({
          kind: 'event',
          stream_id: 'catalog',
          node_id: identity.node,
          seq: 2,
          type,
          actor: { kind: 'node' },
          at: '2025-01-01T00:00:00Z',
          data,
        })
    },
    change(value = 'export const answer = 84\n') {
      text = value
      for (const listener of listeners)
        listener({
          kind: 'event',
          stream_id: 'catalog',
          node_id: identity.node,
          seq: 1,
          type: 'repository.invalidated',
          actor: { kind: 'node' },
          at: '2025-01-01T00:00:00Z',
          data: {
            project_id: identity.project,
            worktree_id: identity.workspace,
            generation: 'generation-next',
            reason: 'filesystem',
          },
        })
    },
  }
}
