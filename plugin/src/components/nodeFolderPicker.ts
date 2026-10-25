// Every folder of every connected node in one searchable list, as Obsidian's quick switcher lists
// notes: a project with all its branches, or one branch's folder, the node's name faint beside it.
// One press gives the chat that place; typing narrows the list first.
import { FuzzySuggestModal, type App, type FuzzyMatch } from "obsidian";
import { t } from "@/i18n";
import type { NodeScopeEntry } from "@/ai/nodeScope";
import type { NodeAgentHost } from "@/ai/tools/node/agent";
import { folderLabels, shortBranch } from "@/ai/tools/node/scopeNames";

export interface NodeFolderChoice {
  entry: NodeScopeEntry;
  folder: string;
  /** The branch, for one worktree; none for a project with all its branches. */
  branch?: string;
  node: string;
}

/** What a chat may be given on the nodes connected now, projects first and their branches after. */
export async function nodeFolderChoices(
  host: NodeAgentHost,
): Promise<NodeFolderChoice[]> {
  const out: NodeFolderChoice[] = [];
  for (const node of host.nodes()) {
    const client = host.connection(node.id).client;
    if (!client.connected) continue;
    const projects = await client.listProjects();
    const labels = folderLabels(
      projects.map((p: { root_path: string }) => p.root_path),
    );
    for (const [i, project] of projects.entries()) {
      const at = {
        node_id: node.id,
        project_id: project.project_id,
        access: "read" as const,
      };
      out.push({
        entry: { kind: "project", ...at },
        folder: labels[i]!,
        node: node.label,
      });
      if (!project.repository_path) continue;
      const { entries } = await client.repository.worktrees({
        project_id: project.project_id,
      });
      if (entries.length < 2) continue;
      for (const tree of entries)
        out.push({
          entry: {
            kind: "target",
            ...at,
            target: { kind: "worktree", worktree_id: tree.worktree_id },
          } as NodeScopeEntry,
          folder: labels[i]!,
          branch: shortBranch(tree.branch ?? tree.path_label),
          node: node.label,
        });
    }
  }
  return out;
}

export class NodeFolderPicker extends FuzzySuggestModal<NodeFolderChoice> {
  constructor(
    app: App,
    private readonly choices: NodeFolderChoice[],
    private readonly pick: (choice: NodeFolderChoice) => void,
  ) {
    super(app);
    this.setPlaceholder(t("chatTree.pickNodeFolder"));
    this.emptyStateText = t("chatTree.noNodeFolders");
  }
  getItems(): NodeFolderChoice[] {
    return this.choices;
  }
  getItemText(c: NodeFolderChoice): string {
    return [c.folder, c.branch, c.node].filter(Boolean).join(" ");
  }
  renderSuggestion(match: FuzzyMatch<NodeFolderChoice>, el: HTMLElement): void {
    const c = match.item;
    el.classList.add("mod-complex");
    const doc = el.ownerDocument;
    const content = el.appendChild(doc.createElement("div"));
    content.className = "suggestion-content";
    const title = content.appendChild(doc.createElement("div"));
    title.className = "suggestion-title";
    title.textContent = c.folder;
    const note = content.appendChild(doc.createElement("div"));
    note.className = "suggestion-note";
    note.textContent = c.branch ?? t("chatTree.allBranches");
    const aux = el.appendChild(doc.createElement("div"));
    aux.className = "suggestion-aux";
    const flair = aux.appendChild(doc.createElement("span"));
    flair.className = "suggestion-flair";
    flair.textContent = c.node;
  }
  onChooseItem(c: NodeFolderChoice): void {
    this.pick(c);
  }
}
