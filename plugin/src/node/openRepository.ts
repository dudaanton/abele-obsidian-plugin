import { Notice, SuggestModal, type App, type PaneType, type WorkspaceLeaf } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { GITHUB_VIEW_TYPE } from '@/github/GithubService'
import { savedNodeTarget } from '@/repository/state'
import type { RepositoryLocation, RepositoryRevision } from '@/repository/source'
import type { NodeRepositoryTarget } from '@/repository/nodeLinks'
import { NodeRepositorySource, WORKING_TREE } from '@/repository/node'
import { NodeService } from './NodeService'

export interface OpenNodeRepositoryOptions {
  path?: string
  revision?: string | RepositoryRevision
  lines?: { from: number; to: number }
  location?: RepositoryLocation
  pane?: PaneType | false
}
/** Common owner opener for files, the command and the node panel. Workspace may be a catalogue
 * worktree ID or an existing managed workspace ID; it is resolved once to its opaque read target.
 * This opener does not grant a chat filesystem access.
 */
export async function openNodeRepository(
  node: string,
  project: string,
  workspace: string,
  options: OpenNodeRepositoryOptions = {}
): Promise<WorkspaceLeaf> {
  const service = NodeService.getInstance(),
    connection = service.connection(node)
  await connection.connect()
  const principal = await connection.client.store.transaction((state) => ({
    installation: state.installation_id,
    node: state.node_id,
  }))
  if (!principal.installation || !principal.node)
    throw new Error('Reconnect this node before opening a repository.')
  const source = new NodeRepositorySource(
    connection.client,
    { provider: 'node', installation: principal.installation, node, project, workspace: 'catalog' },
    { node: '', project: '' }
  )
  const catalog = await source.workspaces()
  source.dispose()
  const selected = catalog.find((row) => row.id === workspace || row.workspaceId === workspace)
  if (!selected)
    throw new Error('This workspace is no longer registered. Choose another workspace.')
  const revision = typeof options.revision === 'object' ? options.revision : undefined
  const ref =
    typeof options.revision === 'string'
      ? options.revision
      : revision?.kind === 'commit'
        ? revision.commit
        : WORKING_TREE
  const target: NodeRepositoryTarget = {
    provider: 'node',
    source: {
      provider: 'node',
      installation: principal.installation,
      node,
      project,
      workspace: selected.id,
    },
    location:
      options.location ??
      (options.path
        ? {
            kind: 'file',
            ref,
            path: options.path,
            ...(options.lines ? { lines: options.lines } : {}),
          }
        : { kind: 'home', ref }),
    ...(revision ? { revision } : {}),
  }
  return openNodeRepositoryTarget(GlobalStore.getInstance().app, target, options.pane)
}

/** Restore/navigation does not discover a replacement for an old worktree ID. */
export async function openNodeRepositoryTarget(
  app: App,
  target: NodeRepositoryTarget,
  pane: PaneType | false = false
): Promise<WorkspaceLeaf> {
  const clean = savedNodeTarget({ sourceTarget: target })
  if (!clean) throw new Error('Invalid node repository target')
  const leaves = app.workspace.getLeavesOfType(GITHUB_VIEW_TYPE)
  const sameWorkspace = (leaf: WorkspaceLeaf) => {
    const saved = (leaf.view as unknown as { model?: { sourceTarget?: NodeRepositoryTarget } })
      .model?.sourceTarget
    return (
      saved?.provider === 'node' && JSON.stringify(saved.source) === JSON.stringify(clean.source)
    )
  }
  const leaf = (!pane && leaves.find(sameWorkspace)) || app.workspace.getLeaf(pane || 'tab')
  await leaf.setViewState({ type: GITHUB_VIEW_TYPE, active: true, state: { sourceTarget: clean } })
  await app.workspace.revealLeaf(leaf)
  return leaf
}

class RepositoryPicker<T> extends SuggestModal<T> {
  constructor(
    app: App,
    private rows: T[],
    private label: (row: T) => string,
    private choose: (row: T) => void,
    placeholder: string
  ) {
    super(app)
    this.setPlaceholder(placeholder)
  }
  getSuggestions(query: string) {
    return this.rows.filter((row) => this.label(row).toLowerCase().includes(query.toLowerCase()))
  }
  renderSuggestion(row: T, el: HTMLElement) {
    el.setText(this.label(row))
  }
  onChooseSuggestion(row: T) {
    this.choose(row)
  }
}
const report = (work: Promise<unknown>) => {
  void work.catch((error) => new Notice(error instanceof Error ? error.message : String(error)))
}
/** Native pickers keep each choice close to what it opens, including an empty project catalogue. */
export function chooseNodeRepository(app: App): void {
  const service = NodeService.getInstance()
  if (!service.nodes.value.length) {
    new Notice('Connect a node in Abele settings first.')
    return
  }
  new RepositoryPicker(
    app,
    service.nodes.value,
    (node) => node.label,
    (node) =>
      report(
        (async () => {
          const connection = service.connection(node.id)
          await connection.connect()
          const projects = [] as Awaited<ReturnType<typeof connection.client.listProjects>>
          let after: string | undefined
          do {
            const page = await connection.client.listProjects(after)
            projects.push(...page)
            if (page.length < 100) break
            after = page.at(-1)!.project_id
            if (projects.length >= 1000) break
          } while (after)
          if (!projects.length) {
            new Notice(
              'This node has no registered projects. Add a project in its workspace dialog.'
            )
            return
          }
          new RepositoryPicker(
            app,
            projects,
            (project) => project.root_path.split(/[\\/]/).pop() || project.project_id,
            (project) =>
              report(
                (async () => {
                  const installation = await connection.client.store.transaction(
                    (state) => state.installation_id!
                  )
                  const source = new NodeRepositorySource(
                    connection.client,
                    {
                      provider: 'node',
                      installation,
                      node: node.id,
                      project: project.project_id,
                      workspace: 'catalog',
                    },
                    { node: node.label, project: '' }
                  )
                  const workspaces = await source.workspaces()
                  source.dispose()
                  if (!workspaces.length) {
                    new Notice('This project has no available workspaces.')
                    return
                  }
                  new RepositoryPicker(
                    app,
                    workspaces,
                    (workspace) =>
                      `${workspace.label} · ${workspace.branch?.replace(/^refs\/heads\//, '') || 'No branch'}${workspace.kind === 'external' ? ' · External' : ''}${workspace.dirty ? ' · Changes' : ''}`,
                    (workspace) =>
                      report(openNodeRepository(node.id, project.project_id, workspace.id)),
                    'Choose a workspace'
                  ).open()
                })()
              ),
            'Choose a project'
          ).open()
        })()
      ),
    'Choose a node'
  ).open()
}
