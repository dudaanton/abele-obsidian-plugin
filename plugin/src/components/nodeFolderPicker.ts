import './nodeFolderPicker.css'
// Every folder of every connected node in one searchable list, as Obsidian's quick switcher lists
// notes: a project with all its branches, or one branch's folder, the node's name faint beside it.
// One press gives the chat that place; typing narrows the list first.
import { FuzzySuggestModal, type App, type FuzzyMatch } from 'obsidian'
import { t } from '@/i18n'
import type { NodeScopeEntry } from '@/ai/nodeScope'
import type { NodeAgentHost } from '@/ai/tools/node/agent'
import { folderLabels, shortBranch } from '@/ai/tools/node/scopeNames'

export interface NodeFolderChoice {
  entry: NodeScopeEntry
  folder: string
  /** The branch, for one worktree; none for a project with all its branches. */
  branch?: string
  node: string
  fullName?: string
}

const generatedWorktreeId = (name: string | null | undefined) =>
  name
    ?.replace(/^refs\/heads\//, '')
    .split(/[\\/]/)
    .slice(-2)
    .join('/')
    .match(/(?:^|\/)abele[/-]([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})(?:-[0-9a-f]+)?$/i)?.[1]

/** What a chat may be given on the nodes connected now, projects first and their branches after. */
export async function nodeFolderChoices(host: NodeAgentHost): Promise<NodeFolderChoice[]> {
  const out: NodeFolderChoice[] = []
  for (const node of host.nodes()) {
    const client = host.connection(node.id).client
    if (!client.connected) continue
    let titles: Promise<Map<string, string>> | undefined
    const sessionTitles = () =>
      (titles ??= (async () => {
        const result = new Map<string, string>()
        try {
          let after: string | undefined
          for (let page = 0; page < 64; page++) {
            const sessions = await client.listSessions(after)
            for (const session of sessions)
              if (session.workspace_id && session.title.trim())
                result.set(session.workspace_id, session.title)
            if (sessions.length < 100 || sessions.at(-1)?.session_id === after) break
            after = sessions.at(-1)?.session_id
          }
        } catch {
          /* Titles are optional; a short generated label stays usable offline. */
        }
        return result
      })())
    const projects = await client.listProjects()
    const labels = folderLabels(projects.map((p: { root_path: string }) => p.root_path))
    for (const [i, project] of projects.entries()) {
      const at = {
        node_id: node.id,
        project_id: project.project_id,
        access: 'read' as const,
      }
      out.push({
        entry: { kind: 'project', ...at },
        folder: labels[i]!,
        node: node.label,
      })
      if (!project.repository_path) continue
      let cursor: string | undefined
      const seen = new Set<string>()
      for (let page = 0; page < 64; page++) {
        const batch = await client.repository.worktrees({ project_id: project.project_id, cursor })
        for (const tree of batch.entries) {
          const generated = generatedWorktreeId(tree.branch) ?? generatedWorktreeId(tree.path_label)
          const title =
            generated && tree.workspace_id
              ? (await sessionTitles()).get(tree.workspace_id)
              : undefined
          out.push({
            entry: {
              kind: 'target',
              ...at,
              target: { kind: 'worktree', worktree_id: tree.worktree_id },
            },
            folder: labels[i]!,
            branch: generated
              ? (title ?? t('chatTree.agentBranch', { id: generated.slice(0, 6) }))
              : shortBranch(tree.branch, tree.path_label),
            fullName: [tree.branch, tree.path_label].filter(Boolean).join(' · '),
            node: node.label,
          })
        }
        if (!batch.cursor) break
        if (seen.has(batch.cursor) || page === 63)
          throw new Error('Node folder list exceeds the page limit')
        seen.add(batch.cursor)
        cursor = batch.cursor
      }
    }
  }
  return out
}

export class NodeFolderPicker extends FuzzySuggestModal<NodeFolderChoice> {
  constructor(
    app: App,
    private readonly choices: NodeFolderChoice[],
    private readonly pick: (choice: NodeFolderChoice) => void
  ) {
    super(app)
    this.setPlaceholder(t('chatTree.pickNodeFolder'))
    this.emptyStateText = t('chatTree.noNodeFolders')
  }
  getItems(): NodeFolderChoice[] {
    return this.choices
  }
  getItemText(c: NodeFolderChoice): string {
    return [c.folder, c.branch, c.node].filter(Boolean).join(' ')
  }
  renderSuggestion(match: FuzzyMatch<NodeFolderChoice>, el: HTMLElement): void {
    const c = match.item
    el.classList.add('mod-complex', 'abele-node-folder-choice')
    el.title = [this.getItemText(c), c.fullName].filter(Boolean).join(' · ')
    const content = el.createDiv({ cls: 'suggestion-content' })
    content.createDiv({ cls: 'suggestion-title', text: c.folder })
    content.createDiv({ cls: 'suggestion-note', text: c.branch ?? t('chatTree.allBranches') })
    el.createDiv({ cls: 'suggestion-aux' }).createSpan({ cls: 'suggestion-flair', text: c.node })
  }
  onChooseItem(c: NodeFolderChoice): void {
    this.pick(c)
  }
}
