import { ref } from 'vue'
import { Platform, type WorkspaceLeaf } from 'obsidian'
import { MemoryClientStore, RepositoryClient, type NodeClient } from '@abele/node-client'
import { GlobalStore } from '@/stores/GlobalStore'
import { NodeService, type NodeConnection } from '@/node/NodeService'
import { GITHUB_VIEW_TYPE } from '@/github/GithubService'
import type { GithubView } from '@/github/GithubView'
import type { RepositoryLocation } from '@/repository/source'
import { WORKING_TREE } from '@/repository/node'
import { nodeRepositoryFixture, identity, BASE, HEAD } from './nodeRepositoryData'

export const NODE_REPOSITORY_SCREENS = [
  'home',
  'file',
  'changes',
  'compare',
  'commits',
  'empty',
  'missing',
  'offline',
] as const
export type NodeRepositoryScreen = (typeof NODE_REPOSITORY_SCREENS)[number]
let leaf: WorkspaceLeaf | undefined
let restore = () => {}
export async function closeNodeRepositoryFixture() {
  if (leaf) await leaf.setViewState({ type: 'empty' })
  leaf = undefined
  restore()
  restore = () => {}
}
/** The actual registered tab, runtime adapter and validating repository client. Only its
 * connection is supplied with anonymous non-executing records; no persisted registry/keys change.
 */
export async function openNodeRepositoryFixture(state: NodeRepositoryScreen = 'home') {
  if (!NODE_REPOSITORY_SCREENS.includes(state)) throw new Error('Unknown repository fixture state')
  await closeNodeRepositoryFixture()
  const app = GlobalStore.getInstance().app
  for (const previous of app.workspace.getLeavesOfType(GITHUB_VIEW_TYPE)) {
    const saved = (previous.view as GithubView).model.sourceTarget
    if (
      saved?.provider === 'node' &&
      saved.source.provider === 'node' &&
      saved.source.node === identity.node
    )
      await previous.setViewState({ type: 'empty' })
  }
  const f = nodeRepositoryFixture(),
    store = new MemoryClientStore()
  await store.transaction((s) => {
    s.node_id = identity.node
    s.installation_id = identity.installation
  })
  const client = {
    ...f.client,
    store,
    target: { expected_node_id: identity.node },
    getProject: async () => ({ project_id: identity.project, root_path: '/sample/Sample project' }),
    repository: new RepositoryClient(async (method, params: any) => {
      const result: any = await f.request(method, params)
      if (method.endsWith('.worktrees')) {
        result.entries[1].branch = 'refs/heads/orca/sample-review'
        result.entries.push({
          ...result.entries[0],
          worktree_id: 'managed-fixture',
          workspace_id: 'workspace-managed-fixture',
          kind: 'managed',
          path_label: 'feature-workspace',
          branch: 'refs/heads/review-layout',
          dirty: false,
        })
        // The visual read fixture does not advertise an editor backed by fake write operations.
        result.entries[0].workspace_id = null
        if (state === 'missing') result.entries[0].availability = 'missing'
        if (state === 'empty')
          result.entries = [{ ...result.entries[0], head: null, branch: null, dirty: false }]
      }
      if (method.endsWith('.compare') && params.head.kind === 'commit') {
        result.entries = result.entries.map(
          ({ path, status }: { path: string; status: string }) => ({ path, status })
        )
      }
      if (state === 'empty') {
        if (method.endsWith('.tree') || method.endsWith('.status') || method.endsWith('.history'))
          result.entries = []
        if (method.endsWith('.observe')) result.revision.head = null
        if (method.endsWith('.refs')) {
          result.entries = []
          result.default_branch = null
        }
      }
      return result
    }),
  } as unknown as NodeClient
  const connection = {
    client,
    state: ref(state === 'offline' ? 'offline' : 'connected'),
    error: ref(''),
    connect: async () => {
      if (state === 'offline') throw new Error('Node offline. Reconnect to browse this repository.')
    },
  } as NodeConnection
  const service = NodeService.getInstance(),
    previousNodes = service.nodes.value,
    previousConnection = service.connection
  service.nodes.value = [
    ...previousNodes,
    {
      id: identity.node,
      expectedNodeId: identity.node,
      label: 'Sample node',
      url: 'http://127.0.0.1:1',
    },
  ]
  service.connection = (id) =>
    id === identity.node ? connection : previousConnection.call(service, id)
  restore = () => {
    service.nodes.value = previousNodes
    service.connection = previousConnection
  }
  const location: RepositoryLocation =
    state === 'file'
      ? { kind: 'file', ref: WORKING_TREE, path: 'app.ts', lines: { from: 1, to: 1 } }
      : state === 'changes'
        ? { kind: 'comparison', base: HEAD, head: WORKING_TREE, direct: true }
        : state === 'compare' || state === 'commits'
          ? { kind: 'comparison', base: BASE, head: HEAD, direct: true }
          : { kind: 'home', ref: WORKING_TREE }
  app.workspace.rightSplit.collapse()
  if (!Platform.isMobile) app.workspace.leftSplit.expand()
  leaf = app.workspace.getLeaf(false)
  await leaf.setViewState({
    type: GITHUB_VIEW_TYPE,
    active: true,
    state: {
      title: 'Sample project · sample-project',
      sourceTarget: { provider: 'node', source: identity, location },
      tree: state === 'file' && !Platform.isMobile,
    },
  })
  await app.workspace.revealLeaf(leaf)
  const view = leaf.view as GithubView
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 200; i++) {
      if (check()) return
      await new Promise((resolve) => window.setTimeout(resolve, 25))
    }
    throw new Error('Repository fixture did not settle')
  }
  await until(() => !!view.model.screen.link || !!view.model.screen.error)
  if (state === 'commits') {
    const tab = Array.from(view.contentEl.querySelectorAll<HTMLElement>('.abele-tabs__tab')).find(
      (el) => el.textContent?.includes('Commits')
    )
    tab?.click()
    await until(() => !!view.contentEl.querySelector('.abele-github-commits'))
  }
  return { state, ready: true }
}
