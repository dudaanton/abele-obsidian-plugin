import { ref } from 'vue'
import type { NodeClient, Project } from '@abele/node-client'
import { Notice } from 'obsidian'
import { t } from '@/i18n'
import { nodeAdvertisesMethod } from './advertisedMethods'
import type { ChatMessage } from '@/ai/types'

export const isCodexNetworkRefusal = (reason?: string | null) =>
  /Network is disabled:|codex_network_disabled|project_network_disabled/.test(reason ?? '')
export const isCodexNetworkMessage = (message: ChatMessage) =>
  ['tool-call', 'tool-result', 'system'].includes(message.role) &&
  isCodexNetworkRefusal(message.toolResult || message.content)

type Client = Pick<NodeClient, 'getProject' | 'setProjectCodexPermissions'>
const controllers = new WeakMap<Client, Map<string, CodexProjectNetwork>>()
export class CodexProjectNetwork {
  readonly enabled = ref(false)
  readonly busy = ref(false)
  readonly name = ref('')
  private loading?: Promise<void>
  private advertised = false
  private revision = 0
  constructor(
    readonly client: Client,
    readonly projectId: string
  ) {}
  get supported() {
    return (this.advertised ||= nodeAdvertisesMethod(this.client, 'project.codex_permissions'))
  }
  private receive(project: Project) {
    this.enabled.value = project.codex_network_enabled === true
    this.name.value = project.root_path.replace(/\/$/, '').split('/').pop() || this.projectId
  }
  load(): Promise<void> {
    const revision = this.revision
    return (this.loading ??= this.client
      .getProject(this.projectId)
      .then((project) => {
        if (revision === this.revision) this.receive(project)
      })
      .finally(() => {
        this.loading = undefined
      }))
  }
  async set(enabled: boolean): Promise<void> {
    if (this.busy.value || !this.supported) return
    this.busy.value = true
    this.revision++
    try {
      this.receive(await this.client.setProjectCodexPermissions(this.projectId, enabled))
      this.revision++
      new Notice(
        t(this.enabled.value ? 'streamB.codexNetworkOnNotice' : 'streamB.codexNetworkOffNotice', {
          project: this.name.value,
        })
      )
    } finally {
      this.busy.value = false
    }
  }
}
export function codexProjectNetwork(client: Client, projectId: string): CodexProjectNetwork {
  let projects = controllers.get(client)
  if (!projects) controllers.set(client, (projects = new Map()))
  let network = projects.get(projectId)
  if (!network) projects.set(projectId, (network = new CodexProjectNetwork(client, projectId)))
  return network
}
