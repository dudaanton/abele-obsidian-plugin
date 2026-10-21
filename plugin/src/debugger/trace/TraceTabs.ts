import { t } from '@/i18n'
import { notesFolderFailureText } from './notesFolder'
// A recorded run and a value of it, each as a tab of the main area, like a node file. Both read the
// node through the owner's connection; neither keeps the values in the saved layout, only where
// they are: the node, the project, the run, the step and the name.
import {
  ItemView,
  Notice,
  Platform,
  type Plugin,
  type ViewStateResult,
  type WorkspaceLeaf,
} from 'obsidian'
import { h, reactive, ref, shallowRef } from 'vue'
import { z } from 'zod'
import TraceRunView from '@/components/debugger/trace/TraceRunView.vue'
import { mountKit, type KitMount } from '@/components/obsidian/mount'
import TraceValueTab from '@/components/debugger/trace/TraceValueTab.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import type { TraceValue } from '@/components/debugger/trace/types'
import { promptDialog } from '@/components/obsidian/dialogs'
import { NodeService } from '@/node/NodeService'
import { GlobalStore } from '@/stores/GlobalStore'
import { DebuggerService } from '../DebuggerService'
import { revealSidebarView } from '@/views/revealSidebarView'
import { runName, shape, value as valueView } from './mapping'
import { TraceRunModel } from './TraceRunModel'
import { TraceRpc } from './wire'
export { traceLink } from './note'

export const TRACE_RUN_VIEW = 'abele-trace-run'
export const TRACE_VALUE_VIEW = 'abele-trace-value'
/** The whole text a value tab reads before saying the rest is on the node. */
const WHOLE_LINES = 20_000

const RunState = z.object({
  registrationId: z.string().min(1),
  projectId: z.string().min(1),
  runId: z.string().min(1),
  name: z.string().optional(),
})
export type TraceRunState = z.infer<typeof RunState>
const ValueState = RunState.extend({
  step: z.string().min(1),
  valueName: z.string().min(1),
  path: z.string().optional(),
  view: z.enum(['shape', 'whole', 'changes']).default('whole'),
})
export type TraceValueState = z.input<typeof ValueState>

function rpcFor(registrationId: string) {
  const connection = NodeService.getInstance().connection(registrationId)
  return {
    connection,
    rpc: new TraceRpc(async (method, params) => {
      await connection.connect()
      return connection.client.request(method, params)
    }),
  }
}

async function markWith(mark: (comment: string) => Promise<unknown>) {
  const comment = await promptDialog({
    title: t('streamC.d7cda0ca2c8586e5'),
    placeholder: t('streamC.6305a3e9f1d952cd'),
    submitText: t('streamC.d7cda0ca2c8586e5'),
  })
  if (comment) await mark(comment)
}

export class TraceRunTab extends ItemView {
  private state?: TraceRunState
  private vue?: KitMount
  private model?: TraceRunModel
  private readonly revision = ref(0)
  private readonly view = shallowRef<{ back(): void } | null>(null)
  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.addAction('file-plus-2', t('streamC.d0d83618cf86b38a'), () => {
      if (this.state)
        void import('./runNote')
          .then((m) => (this.state ? m.writeRunNote(this.state) : undefined))
          .catch(
            (e) =>
              new Notice(
                notesFolderFailureText(e) ??
                  (e instanceof Error ? e.message : t('streamC.152e2ea521d7f367'))
              )
          )
    })
    this.addAction('rotate-cw', t('streamC.68fc976a42ca1ee1'), () => void this.model?.load())
    if (Platform.isPhone)
      this.addAction('arrow-left', t('streamC.0b6281560bd45e4f'), () => this.view.value?.back())
  }
  getViewType() {
    return TRACE_RUN_VIEW
  }
  getDisplayText() {
    return this.model?.run?.name ?? this.state?.name ?? t('streamC.runTab')
  }
  getIcon() {
    return 'diamond'
  }
  getState(): Record<string, unknown> {
    return this.state ? { ...this.state } : {}
  }
  async setState(raw: unknown, result: ViewStateResult) {
    const parsed = RunState.safeParse(raw)
    if (parsed.success) {
      const same =
        this.state?.runId === parsed.data.runId &&
        this.state.projectId === parsed.data.projectId &&
        this.state.registrationId === parsed.data.registrationId &&
        this.model
      this.state = parsed.data
      if (!same) this.start()
    }
    await super.setState(raw, result)
  }
  async onOpen() {
    if (this.state && !this.vue) this.start()
  }
  async onClose() {
    this.model?.dispose()
    this.model = undefined
    this.vue?.unmount()
    this.vue = undefined
  }
  /** Follows a value through this run, from its tab or a link. */
  follow(value: string) {
    void this.model?.follow(value)
  }
  pick(step: string) {
    void this.model?.pick(step)
  }
  pickPoint(point: string) {
    void this.model?.pickPoint(point)
  }
  private start() {
    const state = this.state
    if (!state) return
    this.model?.dispose()
    this.vue?.unmount()
    this.contentEl.replaceChildren()
    this.contentEl.addClass('abele-trace-run-tab')
    let model: TraceRunModel
    try {
      model = this.model = new TraceRunModel(
        rpcFor(state.registrationId).rpc,
        state.projectId,
        state.runId,
        () => {
          ++this.revision.value
          ;(this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.()
        }
      )
    } catch (e) {
      this.vue = mountKit(this.contentEl, EmptyState, {
        text: e instanceof Error ? e.message : t('settings.nodes.unavailable'),
      })
      return
    }
    const act = (work: Promise<unknown>): void => {
      void work.catch(
        (e) => new Notice(e instanceof Error ? e.message : t('streamC.e6f94c778a8708b3'))
      )
    }
    this.vue = mountKit(this.contentEl, {
      render: () => {
        void this.revision.value
        if (!model.run) return h(EmptyState, { text: model.error || t('streamC.ad507ced0123b1c2') })
        const debuggerBinding = DebuggerService.instance.forRun(
          state.registrationId,
          state.projectId,
          model.wire.run.debug_session_id
        )
        return h(TraceRunView, {
          debuggerAvailable: !!debuggerBinding,
          onDebugger: () => {
            if (!debuggerBinding) return
            DebuggerService.instance.select(debuggerBinding)
            act(revealSidebarView(GlobalStore.getInstance().app, 'abele-debug-view'))
          },
          ref: (r: unknown) => (this.view.value = r as { back(): void } | null),
          run: model.run,
          valueMatches: model.valueMatches,
          onSearch: (query: string) => act(model.search(query)),
          picked: model.picked,
          trail: model.trail,
          onPick: (step: string | undefined) => act(model.pick(step)),
          onReveal: (file: string, line: number) => {
            if (debuggerBinding) DebuggerService.instance.reveal(debuggerBinding, file, line)
            else new Notice(t('streamC.d5db98639b66ed79'))
          },
          onOpenValue: (step: string, name: string, path?: string) =>
            act(
              openTraceValue({
                ...state,
                step,
                valueName: name,
                path,
                view: path ? 'whole' : 'shape',
              })
            ),
          onOpenChanges: (step: string, name: string) =>
            act(openTraceValue({ ...state, step, valueName: name, view: 'changes' })),
          onFollow: (value: string) => act(model.follow(value)),
          onUnfollow: () => model.unfollow(),
          onMark: (step: string, at: string) => act(markWith((c) => model.mark(step, at, c))),
          onLink: () => new Notice(t('streamC.d022aaa62c8f31a9')),
        })
      },
    })
    void model.load()
  }
}

export class TraceValueView extends ItemView {
  /** Reactive, so a value that arrives after the tab drew itself empty redraws it. */
  private readonly current = shallowRef<z.output<typeof ValueState>>()
  private get state() {
    return this.current.value
  }
  private vue?: KitMount
  private readonly model = reactive<{
    value?: TraceValue
    runName: string
    stepLabel: string
    error: string
    mode: 'formatted' | 'raw'
    wrap: boolean
  }>({ runName: '', stepLabel: '', error: '', mode: 'formatted', wrap: false })
  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.addAction('copy', t('streamC.a9c0e5986f53d46b'), () => {
      const text = this.model.value?.text
      if (text)
        void navigator.clipboard
          .writeText(text)
          .catch(() => new Notice(t('streamC.298783cd63d0a9a9')))
    })
    this.addAction(
      'wrap-text',
      t('streamC.e4a9d8818437be3e'),
      () => (this.model.wrap = !this.model.wrap)
    )
    this.addAction('diff', t('streamC.4f8d8f13b2908f24'), () => this.show('changes'))
    this.addAction('file-text', t('streamC.ddc9c33c12e5979f'), () => this.show('whole'))
    this.addAction('list-tree', t('streamC.f999218d73af2fbc'), () => this.show('shape'))
  }
  getViewType() {
    return TRACE_VALUE_VIEW
  }
  getDisplayText() {
    return this.state
      ? `${this.state.valueName}${this.state.path && this.state.path !== '$' ? ` ${this.state.path}` : ''}`
      : t('streamC.8e37953d23daca5f')
  }
  getIcon() {
    return 'braces'
  }
  getState(): Record<string, unknown> {
    return this.state ? { ...this.state } : {}
  }
  async setState(raw: unknown, result: ViewStateResult) {
    const parsed = ValueState.safeParse(raw)
    if (parsed.success) {
      this.current.value = parsed.data
      void this.read()
    }
    await super.setState(raw, result)
  }
  async onOpen() {
    this.draw()
  }
  async onClose() {
    this.vue?.unmount()
    this.vue = undefined
  }
  private show(view: 'shape' | 'whole' | 'changes') {
    if (!this.state || this.state.view === view) return
    void this.leaf.setViewState({
      type: TRACE_VALUE_VIEW,
      state: { ...this.state, view },
      active: true,
    })
  }
  private draw() {
    this.vue?.unmount()
    this.contentEl.replaceChildren()
    this.contentEl.addClass('abele-trace-value-view')
    this.vue = mountKit(this.contentEl, {
      render: () => {
        const s = this.state
        const m = this.model
        if (!s || !m.value) return h(EmptyState, { text: m.error || t('streamC.5b6f846c83f79980') })
        return h(TraceValueTab, {
          runName: m.runName,
          stepLabel: m.stepLabel,
          value: m.value,
          path: s.path,
          view: s.view,
          mode: m.mode,
          wrap: m.wrap,
          onFollow: (v: string): void => {
            void openTraceRun(s, { follow: v })
          },
          onMark: (path: string): void => {
            void markWith((comment) =>
              rpcFor(s.registrationId).rpc.mark(s.projectId, s.runId, {
                step: s.step,
                name: s.valueName,
                path,
                comment,
              })
            )
          },
          onPath: (path: string): void => {
            void this.leaf.setViewState({
              type: TRACE_VALUE_VIEW,
              state: { ...s, path, view: 'whole' },
              active: true,
            })
          },
        })
      },
    })
  }
  private async read() {
    const s = this.state
    if (!s) return
    this.model.value = undefined
    this.model.error = ''
    ;(this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.()
    try {
      const { rpc } = rpcFor(s.registrationId)
      const meta = await rpc.value(s.projectId, s.runId, s.step, s.valueName, 'shape')
      const run = await rpc.run(s.projectId, s.runId, 0, 1)
      this.model.runName = runName(run.run)
      const step = await rpc.run(s.projectId, s.runId, Math.max(0, Number(s.step.slice(1)) - 1), 1)
      this.model.stepLabel = step.steps[0]?.label ?? s.step
      const v: TraceValue = valueView(meta.value)
      if (meta.shape) v.shape = shape(meta.shape)
      if (s.view === 'changes') {
        const c = await rpc.value(s.projectId, s.runId, s.step, s.valueName, 'changes')
        const before = c.changes
          ? await this.whole(rpc, s, c.changes.against.step, c.changes.against.name)
          : ''
        v.changes = {
          summary: c.changes?.summary ?? t('streamC.86f8ca0d0827e2ff'),
          before,
          after: await this.whole(rpc, s, s.step, s.valueName),
        }
      } else if (s.view === 'whole') {
        v.text = await this.whole(rpc, s, s.step, s.valueName, s.path)
      }
      if (this.state === s) this.model.value = v
    } catch (e) {
      console.debug('[trace] Value unavailable', e)
      if (this.state === s)
        this.model.error = e instanceof Error ? e.message : t('streamC.71d4a48478f0d583')
    }
  }
  /** The value's text, page by page from the node, up to what a tab can hold. */
  private async whole(
    rpc: TraceRpc,
    s: z.output<typeof ValueState>,
    step: string,
    name: string,
    path?: string
  ) {
    const lines: string[] = []
    let from = 0
    for (;;) {
      const r = await rpc.value(
        s.projectId,
        s.runId,
        step,
        name,
        path && path !== '$' ? 'slice' : 'page',
        {
          ...(path && path !== '$' ? { path } : {}),
          from,
        }
      )
      const page = r.page
      if (!page) break
      lines.push(...page.lines)
      if (page.next === undefined || lines.length >= WHOLE_LINES) {
        if (page.next !== undefined)
          lines.push(t('streamC.16b0dc8d7dd2cb94', { v1: String(page.total - lines.length) }))
        break
      }
      from = page.next
    }
    return lines.join('\n')
  }
}

export function registerTraceTabs(plugin: Plugin) {
  plugin.registerView(TRACE_RUN_VIEW, (leaf) => new TraceRunTab(leaf))
  plugin.registerView(TRACE_VALUE_VIEW, (leaf) => new TraceValueView(leaf))
  // obsidian://abele-trace?node=…&project=…&run=…[&step=…&name=…&path=…]: a run or a value of it,
  // from a note about the run.
  plugin.registerObsidianProtocolHandler('abele-trace', (params) => {
    const base = {
      registrationId: params.node ?? '',
      projectId: params.project ?? '',
      runId: params.run ?? '',
    }
    const open =
      params.step && params.name
        ? openTraceValue({
            ...base,
            step: params.step,
            valueName: params.name,
            path: params.path,
            view: params.path ? 'whole' : 'shape',
          })
        : openTraceRun(base)
    void open.catch(
      (e) =>
        new Notice(
          e instanceof Error && /Reconnect|disconnected|unavailable/i.test(e.message)
            ? t('streamC.e30864cee8d2d9e5')
            : e instanceof Error
              ? e.message
              : t('streamC.aad12ffac73b0f86')
        )
    )
  })
}

/** Opens a run in a tab of the main area, reusing the tab it is already in. */
export async function openTraceRun(
  state: TraceRunState,
  options: { follow?: string; step?: string; point?: string } = {}
) {
  const { workspace } = GlobalStore.getInstance().app
  const parsed = RunState.parse(state)
  const existing = workspace.getLeavesOfType(TRACE_RUN_VIEW).find((l) => {
    const saved = (l.view as TraceRunTab).getState()
    return (
      saved.runId === parsed.runId &&
      saved.projectId === parsed.projectId &&
      saved.registrationId === parsed.registrationId
    )
  })
  const leaf = existing ?? workspace.getLeaf('tab')
  await leaf.setViewState({ type: TRACE_RUN_VIEW, state: parsed, active: true })
  await workspace.revealLeaf(leaf)
  const view = leaf.view as TraceRunTab
  if (options.step) view.pick(options.step)
  if (options.point) view.pickPoint(options.point)
  if (options.follow) view.follow(options.follow)
}

export async function openTraceValue(state: TraceValueState) {
  const { workspace } = GlobalStore.getInstance().app
  const parsed = ValueState.parse(state)
  const leaf = Platform.isPhone ? workspace.getLeaf('tab') : workspace.getLeaf('split', 'vertical')
  await leaf.setViewState({ type: TRACE_VALUE_VIEW, state: parsed, active: true })
  await workspace.revealLeaf(leaf)
}
