import { t } from '@/i18n'
import { ItemView, SuggestModal, Notice, type Plugin, type ViewStateResult } from 'obsidian'
import { mountKit, type KitMount } from '@/components/obsidian/mount'
import { debugTarget, isFolderOwner, type DebugOwner } from './owner'
import type { DebuggerSnapshot } from '@abele/node-protocol'
import { GlobalStore } from '@/stores/GlobalStore'
import { DebuggerService, type DebuggerBinding } from './DebuggerService'
import { debuggerKey } from './DebuggerController'
import { restoreBreakpoint } from './restoreBreakpoint'
import DebuggerView from './DebuggerView.vue'
import { registerDebugValues } from './DebugValueTab'
import { registerTraceTabs } from './trace/TraceTabs'
import { revealSidebarView } from '@/views/revealSidebarView'
import { registerDebuggerSelection } from './selection'
export const DEBUG_VIEW_TYPE = 'abele-debug-view'
export class DebugView extends ItemView {
  private vue?: KitMount
  private savedState: Record<string, unknown> = {}
  getState() {
    const state = DebuggerService.instance.selectionState()
    if (state !== undefined) this.savedState = state
    return this.savedState
  }
  async setState(state: unknown, result: ViewStateResult) {
    if (state && typeof state === 'object' && !Array.isArray(state) && 'sessionId' in state)
      this.savedState = { ...state }
    try {
      const { folderOwner } = await import('./folderActions')
      await DebuggerService.instance.restoreSelection(state, folderOwner)
      const service = DebuggerService.instance,
        binding = service.active.value
      const owner = binding && service.owner(binding)
      const sessionId = binding?.controller.snapshot?.debug_session_id
      if (binding && owner && sessionId) configureSessionActions(owner, binding, sessionId)
    } catch (error) {
      console.debug('[debugger] Saved session unavailable', error)
    }
    await super.setState(state, result)
  }
  getViewType() {
    return DEBUG_VIEW_TYPE
  }
  getDisplayText() {
    return t('streamC.1a03bd2fd107c453')
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
  // Loaded after view registration to keep folder actions independent of chat startup.
  void import('./folderActions').then(({ registerFolderDebugCommands }) =>
    registerFolderDebugCommands(plugin)
  )
  registerDebugValues(plugin)
  registerTraceTabs(plugin)
  plugin.registerView(DEBUG_VIEW_TYPE, (leaf) => new DebugView(leaf))
  registerDebuggerSelection(plugin, DEBUG_VIEW_TYPE)
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
    private readonly presenter: DebugOwner,
    private readonly sessions: DebuggerSnapshot[]
  ) {
    super(GlobalStore.getInstance().app)
    this.setPlaceholder(t('streamC.95b22255ddc6fba2'))
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
export async function showSession(presenter: DebugOwner, sessionId: string) {
  const service = DebuggerService.instance,
    binding = service.binding(presenter, sessionId)
  service.select(binding)
  // Opening the session may reveal its paused source and close a phone drawer.
  // Show Debug after that navigation, so the controls stay on screen.
  await binding.open(sessionId)
  if (isFolderOwner(presenter))
    void service
      .discover(presenter)
      .catch((error) => console.debug('[debugger] Other sessions unavailable', error))
  configureSessionActions(presenter, binding, sessionId)
  // The shared reveal: on a phone a drawer can count as open while nothing of it is on screen,
  // and only closing and opening it again shows the panel.
  await revealSidebarView(GlobalStore.getInstance().app, DEBUG_VIEW_TYPE)
  GlobalStore.getInstance().app.workspace.requestSaveLayout?.()
}
function configureSessionActions(
  presenter: DebugOwner,
  binding: DebuggerBinding,
  sessionId: string
) {
  if (isFolderOwner(presenter)) {
    // The node retains the recipe, so ended sessions can restart after reopening the plugin.
    const restart = async () => {
      const carried = [...(binding.retainedBreakpoints ?? [])]
      const recordPoints = [...(binding.trace?.points ?? [])]
      if (binding.sessionMissing) {
        const { askAndStartProgram, carriedPoints } = await import('./startProgram')
        return askAndStartProgram(
          presenter,
          (id) => showSession(presenter, id),
          carriedPoints(binding)
        )
      }
      const client = presenter.connection.client
      const { snapshot: previous } = await client.debugger.status(sessionId)
      binding.controller.observe(client.debugger.current(sessionId))
      if (!['terminated', 'detached', 'failed', 'connection-lost'].includes(previous.lifecycle)) {
        if (!binding.controller.current)
          throw new Error('Reconnect to the debugger before restarting')
        await binding.controller.command('stop')
      }
      const { StartResultSchema, registerSources, openSources } = await import('./startProgram')
      const target = await debugTarget(presenter)
      if (!target) return
      const started = StartResultSchema.parse(
        await presenter.connection.client.request('debugger.v1.restart', {
          operation_id: crypto.randomUUID(),
          debug_session_id: sessionId,
        })
      )
      const snapshot = await registerSources(presenter, started, target)
      await openSources(presenter, started, snapshot.incarnation, target)
      await showSession(presenter, started.debug_session_id)
      const next = DebuggerService.instance.binding(presenter, started.debug_session_id)
      for (const point of carried) {
        const source = started.sources.find((source) => source.path === point.file)
        if (!source) continue
        const record = recordPoints.find((record) => record.breakpoint_id === point.id)
        if (record && next.trace) {
          await next.trace.savePoint(source.source_id, point.requestedLine, {
            take: record.take,
            ...(point.condition ? { when: point.condition } : {}),
            ...(record.note ? { note: record.note } : {}),
            ...(point.enabled !== undefined ? { enabled: point.enabled } : {}),
            ...(point.hit_condition ? { hitCondition: point.hit_condition } : {}),
          })
        } else await restoreBreakpoint(next.controller, source.source_id, point)
      }
    }
    if (binding.controller.snapshot?.target.process_ownership === 'external') {
      binding.rerun = undefined
      binding.reattach = restart
    } else {
      binding.rerun = restart
      binding.reattach = undefined
    }
  }
}
/** Runs a program of the chat's folder under the debugger and shows its session. */
export async function startNodeProgram(presenter: DebugOwner) {
  const { askAndStartProgram } = await import('./startProgram')
  await askAndStartProgram(presenter, (sessionId) => showSession(presenter, sessionId))
}
/** Attaches the debugger to a Node.js program already running on the node and shows its session. */
export async function attachNodeProgram(presenter: DebugOwner) {
  const { askAndAttachProgram } = await import('./attachProgram')
  await askAndAttachProgram(presenter, (sessionId) => showSession(presenter, sessionId))
}
/** The chat's debug sessions: one opens at once, several are offered to pick from. */
export async function openNodeDebugger(
  presenter: DebugOwner,
  beforeStart?: () => Promise<boolean>
) {
  try {
    const service = DebuggerService.instance,
      sessions = await service.sessions(presenter)
    // Nothing to show yet: the way to a session is running a program, so that is asked at once.
    if (!sessions.length) {
      if (beforeStart && !(await beforeStart())) return
      return await startNodeProgram(presenter)
    }
    if (sessions.length === 1) await showSession(presenter, sessions[0].debug_session_id)
    else new SessionPicker(presenter, sessions).open()
  } catch (e) {
    console.debug('[debugger] Debug session selection unavailable', e)
    new Notice(
      e instanceof Error
        ? t('streamC.d7d8996f39a79106', { v1: String(e.message) })
        : t('streamC.c53799db18f59411')
    )
  }
}
