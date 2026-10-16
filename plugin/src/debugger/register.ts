import { ItemView, SuggestModal, Notice, type Plugin } from 'obsidian'
import { mountKit, type KitMount } from '@/components/obsidian/mount'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import type { DebuggerSnapshot } from '@abele/node-protocol'
import { GlobalStore } from '@/stores/GlobalStore'
import { DebuggerService } from './DebuggerService'
import { debuggerKey } from './DebuggerController'
import DebuggerView from './DebuggerView.vue'
import { registerDebugValues } from './DebugValueTab'
import { registerTraceTabs } from './trace/TraceTabs'
import { revealSidebarView } from '@/views/revealSidebarView'
export const DEBUG_VIEW_TYPE = 'abele-debug-view'
export class DebugView extends ItemView {
  private vue?: KitMount
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
    this.vue = mountKit(this.contentEl, DebuggerView, null, { owner: this })
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
  // Opening the session may reveal its paused source and close a phone drawer.
  // Show Debug after that navigation, so the controls stay on screen.
  await binding.open(sessionId)
  // The shared reveal: on a phone a drawer can count as open while nothing of it is on screen,
  // and only closing and opening it again shows the panel.
  await revealSidebarView(GlobalStore.getInstance().app, DEBUG_VIEW_TYPE)
}
/** Runs a program of the chat's folder under the debugger and shows its session. */
export async function startNodeProgram(presenter: NodeChatPresenter) {
  const { askAndStartProgram } = await import('./startProgram')
  await askAndStartProgram(presenter, (sessionId) => showSession(presenter, sessionId))
}
/** Attaches the debugger to a Node.js program already running on the node and shows its session. */
export async function attachNodeProgram(presenter: NodeChatPresenter) {
  const { askAndAttachProgram } = await import('./attachProgram')
  await askAndAttachProgram(presenter, (sessionId) => showSession(presenter, sessionId))
}
/** The chat's debug sessions: one opens at once, several are offered to pick from. */
export async function openNodeDebugger(presenter: NodeChatPresenter) {
  try {
    const service = DebuggerService.instance,
      sessions = await service.sessions(presenter)
    // Nothing to show yet: the way to a session is running a program, so that is asked at once.
    if (!sessions.length) return await startNodeProgram(presenter)
    if (sessions.length === 1) await showSession(presenter, sessions[0].debug_session_id)
    else new SessionPicker(presenter, sessions).open()
  } catch (e) {
    console.debug('[debugger] Debug session selection unavailable', e)
    new Notice(
      e instanceof Error ? `Debug unavailable: ${e.message}` : 'Debug unavailable on this node'
    )
  }
}
