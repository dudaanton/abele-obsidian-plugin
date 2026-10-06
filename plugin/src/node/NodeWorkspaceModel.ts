import { ref } from 'vue'
import type { NodeClient, Project, Workspace, Job } from '@abele/node-client'

export type NodeSession = Awaited<ReturnType<NodeClient['getSession']>>
/** Lists can be byte-bounded well below 256 entries. Only an empty page is terminal. */
export async function nodePages<T>(
  read: (after?: string) => Promise<T[]>,
  id: (item: T) => string
): Promise<T[]> {
  const all: T[] = []
  let after: string | undefined
  for (;;) {
    const page = await read(after)
    if (!page.length) return all
    const next = id(page[page.length - 1])
    if (next === after) throw new Error('Node pagination did not advance')
    all.push(...page)
    after = next
  }
}

/** All effects stay in the durable node client, independent of Obsidian and transport. */
export class NodeWorkspaceModel {
  readonly projects = ref<Project[]>([])
  readonly workspaces = ref<Workspace[]>([])
  readonly sessions = ref<NodeSession[]>([])
  readonly jobs = ref<Job[]>([])
  readonly projectId = ref('')
  readonly workspaceId = ref('')
  readonly reservation = ref<{ workspace_id: string; job_id: string }>()
  readonly status = ref<Awaited<ReturnType<NodeClient['workspaceStatus']>>['entries']>([])
  readonly diff = ref<Awaited<ReturnType<NodeClient['workspaceDiff']>>>()
  readonly description = ref<unknown>()
  private generation = 0
  constructor(
    readonly client: NodeClient,
    private readonly beforeStart: () => void = () => {}
  ) {}
  async load(): Promise<void> {
    const generation = ++this.generation
    const [projects, sessions, description] = await Promise.all([
      nodePages(
        (after) => this.client.listProjects(after),
        (p) => p.project_id
      ),
      nodePages(
        (after) => this.client.listSessions(after),
        (s) => s.session_id
      ),
      this.client.describe(),
    ])
    if (generation !== this.generation) return
    this.projects.value = projects
    this.sessions.value = sessions
    this.description.value = description
    if (!this.projectId.value && this.workspaceId.value) {
      const workspace = await this.client.getWorkspace(this.workspaceId.value)
      this.projectId.value = workspace.project_id
    }
    if (!projects.some((p) => p.project_id === this.projectId.value))
      this.projectId.value = projects[0]?.project_id ?? ''
    await this.selectProject(this.projectId.value)
  }
  async selectProject(id: string): Promise<void> {
    this.projectId.value = id
    const [workspaces, jobs] = id
      ? await Promise.all([
          nodePages(
            (after) => this.client.listWorkspaces(id, after),
            (w) => w.workspace_id
          ),
          nodePages(
            (after) => this.client.listJobs(id, after),
            (j) => j.job_id
          ),
        ])
      : [[], []]
    if (this.projectId.value !== id) return
    this.workspaces.value = workspaces
    this.jobs.value = jobs
    if (!workspaces.some((w) => w.workspace_id === this.workspaceId.value))
      this.workspaceId.value =
        workspaces.find((w) => w.kind === 'managed' && w.state === 'ready')?.workspace_id ??
        workspaces[0]?.workspace_id ??
        ''
  }
  async register(path: string, trusted: boolean): Promise<void> {
    const project = await this.client.registerProject(path, trusted ? 'trusted' : 'untrusted')
    this.projectId.value = project.project_id
    await this.load()
  }
  async createWorkspace(base: string): Promise<void> {
    if (!this.projectId.value) throw new Error('Choose a project first')
    this.reservation.value = await this.client.createWorkspace(this.projectId.value, base)
    this.workspaceId.value = this.reservation.value.workspace_id
    await this.load()
  }
  async startSession(title: string, provider: 'fake' | 'claude'): Promise<NodeSession> {
    this.beforeStart()
    const workspace = this.workspaces.value.find((w) => w.workspace_id === this.workspaceId.value)
    if (!workspace || workspace.kind !== 'managed' || workspace.state !== 'ready')
      throw new Error('Choose a ready managed workspace first')
    if (this.sessions.value.some((s) => s.workspace_id === workspace.workspace_id))
      throw new Error('This workspace already has a session; open it instead')
    return this.client.createSession(title, workspace.workspace_id, provider)
  }
  async preview(): Promise<void> {
    const id = this.workspaceId.value
    if (!id) throw new Error('Choose a workspace first')
    const entries: typeof this.status.value = []
    let offset = 0
    for (;;) {
      const page = await this.client.workspaceStatus(id, offset)
      entries.push(...page.entries)
      if (page.next_offset === null) break
      if (page.next_offset <= offset) throw new Error('Node status pagination did not advance')
      offset = page.next_offset
    }
    const diff = await this.client.workspaceDiff(id)
    if (this.workspaceId.value !== id) return
    this.status.value = entries
    this.diff.value = diff
  }
}
