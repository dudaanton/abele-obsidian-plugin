import { ItemView, SuggestModal, Notice, type Plugin } from 'obsidian'
import { createApp, type App as VueApp } from 'vue'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import type { DebuggerSnapshot } from '@abele/node-protocol'
import { GlobalStore } from '@/stores/GlobalStore'
import { DebuggerService } from './DebuggerService'
import { debuggerKey } from './DebuggerController'
import DebuggerView from './DebuggerView.vue'
import { registerDebugValues } from './DebugValueTab'
import { registerTraceTabs } from './trace/TraceTabs'
export const DEBUG_VIEW_TYPE = 'abele-debug-view'
export class DebugView extends ItemView {
  private vue?: VueApp
  getViewType() {
    return DEBUG_VIEW_TYPE
  }
  getDisplayText() {
    return 'Debug'
  }
  getIcon() {
    return 'bug-play'
  }
  async onOpen() {
    this.contentEl.replaceChildren()
    this.vue = createApp(DebuggerView)
    this.vue.mount(this.contentEl)
  }
  async onClose() {
    this.vue?.unmount()
    this.vue = undefined
  }
}
export function registerDebugger(plugin: Plugin) {
  registerDebugValues(plugin)
  registerTraceTabs(plugin)
  plugin.registerView(DEBUG_VIEW_TYPE, (leaf) => new DebugView(leaf))
  const keyboard = (event: KeyboardEvent) => {
    const action = debuggerKey(event),
      binding = DebuggerService.instance.active.value
    if (!action || !binding?.controller.current || event.defaultPrevented || event.repeat) return
    event.preventDefault()
    void binding.controller
      .command(action)
      .then(() => binding.refresh())
      .catch((e) => binding.fail(e))
  }
  // Workspace popouts use their own document. The registration helper owns both lifetimes.
  plugin.registerDomEvent(document, 'keydown', keyboard)
  plugin.registerEvent(
    plugin.app.workspace.on('window-open', (_win, window) => {
      plugin.registerDomEvent(window.document, 'keydown', keyboard)
    })
  )
  plugin.register(() => DebuggerService.instance.destroy())
}
class SessionPicker extends SuggestModal<DebuggerSnapshot> {
  constructor(
    private readonly presenter: NodeChatPresenter,
    private readonly sessions: DebuggerSnapshot[]
  ) {
    super(GlobalStore.getInstance().app)
    this.setPlaceholder('Select a debug session')
  }
  getSuggestions(query: string) {
    return this.sessions.filter((s) =>
      `${s.target.launch_configuration_id} ${s.debug_session_id}`
        .toLowerCase()
        .includes(query.toLowerCase())
    )
  }
  renderSuggestion(s: DebuggerSnapshot, el: HTMLElement) {
    el.setText(`${s.target.launch_configuration_id} · ${s.lifecycle}`)
  }
  onChooseSuggestion(s: DebuggerSnapshot) {
    void showSession(this.presenter, s.debug_session_id)
  }
}
async function showSession(presenter: NodeChatPresenter, sessionId: string) {
  const service = DebuggerService.instance,
    binding = service.binding(presenter)
  service.select(binding)
  const { workspace } = GlobalStore.getInstance().app
  const leaf = workspace.getLeavesOfType(DEBUG_VIEW_TYPE)[0] ?? workspace.getRightLeaf(false)
  if (!leaf) {
    new Notice('The debug sidebar is unavailable')
    return
  }
  await leaf.setViewState({ type: DEBUG_VIEW_TYPE, active: true })
  await workspace.revealLeaf(leaf)
  await binding.open(sessionId)
}
/** Runs a program of the chat's folder under the debugger and shows its session. */
export async function startNodeProgram(presenter: NodeChatPresenter) {
  const { askAndStartProgram } = await import('./startProgram')
  await askAndStartProgram(presenter, (sessionId) => showSession(presenter, sessionId))
}
/** The chat's debug sessions: one opens at once, several are offered to pick from. */
export async function openNodeDebugger(presenter: NodeChatPresenter) {
  try {
    const service = DebuggerService.instance,
      sessions = await service.sessions(presenter)
    if (!sessions.length) {
      new Notice('No debug sessions. Start one from the chat menu: run a program.')
      return
    }
    if (sessions.length === 1) await showSession(presenter, sessions[0].debug_session_id)
    else new SessionPicker(presenter, sessions).open()
  } catch (e) {
    console.debug('[debugger] Debug session selection unavailable', e)
    new Notice(
      e instanceof Error ? `Debug unavailable: ${e.message}` : 'Debug unavailable on this node'
    )
  }
}
