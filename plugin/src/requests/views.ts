// The saved requests in Obsidian: a view of their own in the left sidebar, as Bookmarks, and each
// request a tab of the main area, its answer beside it. Both read one model per project; neither
// keeps a request in the saved layout, only where it is: the node, the project and the file.
import { ItemView, Notice, type Plugin, type ViewStateResult, type WorkspaceLeaf } from 'obsidian'
import {
  computed,
  createApp,
  defineComponent,
  h,
  onMounted,
  shallowRef,
  watch,
  type App as VueApp,
} from 'vue'
import { z } from 'zod'
import RequestsPanel from '@/components/debugger/http/RequestsPanel.vue'
import RequestView from '@/components/debugger/http/RequestView.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import type {
  HttpCheck,
  HttpCollection,
  HttpPair,
  HttpRequest,
} from '@/components/debugger/http/types'
import { NodeService } from '@/node/NodeService'
import { revealSidebarView } from '@/views/revealSidebarView'
import {
  REQUEST_TAB_VIEW,
  app,
  copyCurl,
  environmentMenu,
  newCollection,
  newRequest,
  openRequestTab,
  projectMenu,
  rename,
  requestMenu,
  say,
  sendFromView,
} from './actions'
import { keyPort, RequestsService, RequestsContextSchema } from './RequestsService'
import type { RequestsModel } from './RequestsModel'
import { pairsForView } from './resolve'
import type { Pair, RequestDoc } from './wire'

export const REQUESTS_VIEW = 'abele-requests'
export { REQUEST_TAB_VIEW }

// ── What the components draw, from the model ──

function viewRequest(id: string, doc: RequestDoc, checks?: HttpCheck[]): HttpRequest {
  return {
    id,
    name: doc.name,
    method: doc.method,
    url: doc.url,
    params: pairsForView(doc.params, (name) => keyPort.has(name)),
    headers: pairsForView(doc.headers, (name) => keyPort.has(name)),
    ...(doc.body ? { body: doc.body } : {}),
    scripts: doc.scripts,
    checks: doc.checks.map((text) => ({
      text,
      ...(checks?.some((c) => c.text === text)
        ? { passed: checks.find((c) => c.text === text)?.passed }
        : {}),
    })),
  }
}

const plainPairs = (pairs: HttpPair[]): Pair[] =>
  pairs.map((p) => ({ key: p.key, value: p.value, ...(p.off ? { off: true } : {}) }))

function docOf(r: HttpRequest): RequestDoc {
  return {
    name: r.name,
    method: r.method,
    url: r.url,
    params: plainPairs(r.params),
    headers: plainPairs(r.headers),
    ...(r.body ? { body: r.body } : {}),
    scripts: r.scripts,
    checks: r.checks.map((c) => c.text),
  }
}

/** The environment's values as the tab shows what the address comes to: a secret blanked. */
function shownVars(model: RequestsModel): HttpPair[] {
  const secrets = model.secrets()
  return (model.state.env?.vars ?? []).flatMap((v) =>
    v.off
      ? []
      : v.secret
        ? secrets[v.key] !== undefined
          ? [{ key: v.key, value: '••••', secret: true }]
          : []
        : [{ key: v.key, value: v.value ?? '' }]
  )
}

// ── The sidebar view ──

const Sidebar = defineComponent({
  setup() {
    const service = RequestsService.instance()
    const context = service.context
    const model = computed(() => (context.value ? service.model(context.value) : undefined))
    const connection = computed(() =>
      context.value ? NodeService.getInstance().connection(context.value.registrationId) : undefined
    )
    const recording = computed(() =>
      context.value ? service.recording(context.value).value : undefined
    )
    const load = (): void => {
      void model.value?.load().catch(() => {})
    }
    onMounted(load)
    watch(context, load)
    watch(
      () => connection.value?.state.value,
      (state, was) => {
        if (state === 'connected' && was !== 'connected') load()
      }
    )
    return () => {
      const c = context.value
      const m = model.value
      const offline = !!m?.state.error && connection.value?.state.value !== 'connected'
      const notice = !c
        ? 'Choose the project of a node whose requests to show.'
        : m?.state.error && !offline
          ? /unsupported_method/.test(m.state.error)
            ? 'This node does not keep saved requests yet. Update it.'
            : m.state.error
          : undefined
      const collections: HttpCollection[] = (m?.state.collections ?? []).map((col) => ({
        name: col.name || 'Requests',
        requests: col.requests.map((r) => ({
          id: r.id,
          name: r.name,
          method: r.method,
          url: r.url,
          params: [] as HttpPair[],
          headers: [] as HttpPair[],
          scripts: {},
          checks: [] as HttpCheck[],
          ...(r.last
            ? {
                last:
                  r.last.failed || r.last.unknown ? { failed: true } : { status: r.last.status },
              }
            : {}),
        })),
      }))
      const open = service.openRequest.value
      return h(RequestsPanel, {
        collections,
        environment: m?.state.environment,
        offline,
        notice,
        project: c?.label ?? '',
        node: c?.node,
        open: open && c && open.projectId === c.projectId ? open.id : undefined,
        sending: m?.state.sending.at(-1),
        recording: recording.value?.name,
        onOpenRequest: (id: string): void => {
          if (c) void openRequestTab(c, id).catch(say)
        },
        onSendRequest: (id: string): void => {
          if (c) void openRequestTab(c, id).then(() => sendFromView(c, id), say)
        },
        onRequestMenu: (id: string, e: MouseEvent): void => {
          if (c) requestMenu(c, id, e)
        },
        onEnvironmentMenu: (e: MouseEvent): void => {
          if (m) environmentMenu(m, e)
        },
        onNewRequest: (): void => {
          if (c) void newRequest(c).catch(say)
        },
        onNewCollection: (): void => {
          if (c) void newCollection(c).catch(say)
        },
        onShowRecording: (): void => {
          void import('@/debugger/register').then((d) =>
            revealSidebarView(app(), d.DEBUG_VIEW_TYPE)
          )
        },
        onProjectMenu: (e: MouseEvent): void => {
          void projectMenu(e)
        },
      })
    }
  },
})

export class RequestsView extends ItemView {
  private vue?: VueApp
  getViewType() {
    return REQUESTS_VIEW
  }
  getDisplayText() {
    return 'Requests'
  }
  getIcon() {
    return 'send-horizontal'
  }
  async onOpen() {
    this.contentEl.replaceChildren()
    this.contentEl.addClass('abele-requests-view')
    this.vue = createApp(Sidebar)
    this.vue.mount(this.contentEl)
  }
  async onClose() {
    this.vue?.unmount()
    this.vue = undefined
  }
}

// ── A request's tab ──

const TabState = RequestsContextSchema.pick({ registrationId: true, projectId: true }).extend({
  id: z.string().min(1),
})
type TabState = z.infer<typeof TabState>

export class RequestTab extends ItemView {
  private readonly current = shallowRef<TabState>()
  private vue?: VueApp
  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.addAction('terminal', 'Copy as curl', () => {
      const s = this.current.value
      if (s) void copyCurl(RequestsService.instance().model(s), s.id).catch(say)
    })
    this.addAction('pencil', 'Rename', () => {
      const s = this.current.value
      if (s) void rename(s, s.id).catch(say)
    })
  }
  getViewType() {
    return REQUEST_TAB_VIEW
  }
  getDisplayText() {
    const s = this.current.value
    if (!s) return 'Request'
    return (
      RequestsService.instance().model(s).entry(s.id).doc?.name ??
      s.id
        .split('/')
        .pop()
        .replace(/\.http$/, '')
    )
  }
  getIcon() {
    return 'send-horizontal'
  }
  getState(): Record<string, unknown> {
    return this.current.value ? { ...this.current.value } : {}
  }
  async setState(raw: unknown, result: ViewStateResult) {
    const parsed = TabState.safeParse(raw)
    if (parsed.success) {
      const was = this.current.value
      this.current.value = parsed.data
      if (was?.id !== parsed.data.id || was.projectId !== parsed.data.projectId) this.read()
    }
    await super.setState(raw, result)
  }
  async onOpen() {
    this.draw()
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (leaf === this.leaf && this.current.value)
          RequestsService.instance().openRequest.value = this.current.value
      })
    )
  }
  async onClose() {
    const s = this.current.value
    if (s) void RequestsService.instance().model(s).flush(s.id).catch(say)
    this.vue?.unmount()
    this.vue = undefined
  }
  private header() {
    ;(this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.()
  }
  private read() {
    const s = this.current.value
    if (!s) return
    RequestsService.instance().openRequest.value = s
    const model = RequestsService.instance().model(s)
    const ready =
      model.state.environments.length || model.state.collections.length
        ? Promise.resolve()
        : model.load()
    void ready
      .then(() => model.open(s.id))
      .then(() => this.header())
      .catch((e) => console.debug('[requests] Request not read', e))
  }
  private draw() {
    this.contentEl.replaceChildren()
    this.contentEl.addClass('abele-request-tab')
    const current = this.current
    const header = () => this.header()
    this.vue = createApp(
      defineComponent({
        setup() {
          return () => {
            const s = current.value
            if (!s) return h(EmptyState, { text: 'No request' })
            const service = RequestsService.instance()
            const model = service.model(s)
            const entry = model.entry(s.id)
            const doc = entry.doc
            if (!doc) return h(EmptyState, { text: entry.error ?? 'Reading the request…' })
            const recording = service.recording(s).value
            const outcome = entry.outcome
            const checks = outcome?.kind === 'answered' ? outcome.response.checks : undefined
            return h(RequestView, {
              request: viewRequest(s.id, doc, checks),
              environment: model.state.environment ?? 'no environment',
              vars: shownVars(model),
              outcome,
              history: entry.history,
              shownSend: entry.shown,
              compareWith: entry.compare,
              recording: recording?.name,
              intoRecording: model.state.intoRecording,
              onChange: (r: HttpRequest): void => {
                model.change(s.id, docOf(r))
                if (r.name !== doc.name) header()
              },
              onSend: (): void => sendFromView(s, s.id),
              onOpenRun: (): void => {
                const sendId = entry.shown ?? entry.history[0]?.id
                const run = sendId ? entry.runs.get(sendId) : undefined
                if (!run) return
                void import('@/debugger/trace/TraceTabs')
                  .then((t) =>
                    t.openTraceRun(
                      {
                        registrationId: s.registrationId,
                        projectId: s.projectId,
                        runId: run.runId,
                      },
                      run.step ? { step: run.step } : {}
                    )
                  )
                  .catch(say)
              },
              onOpenScript: (name: string): void => {
                void import('@/scripting/runScript').then(({ findScriptByName }) => {
                  const script = findScriptByName(name)
                  if (script) void app().workspace.openLinkText(script.path, '', 'tab')
                  else new Notice(`There is no script named ${name}`)
                })
              },
              onIntoRecording: (on: boolean): void => {
                model.state.intoRecording = on
              },
              onShowSend: (id: string): void => {
                void model.showSend(s.id, id).catch(say)
              },
              onCompare: (id: string | undefined): void => {
                void model.compare(s.id, id).catch(say)
              },
            })
          }
        },
      })
    )
    this.vue.mount(this.contentEl)
  }
}

export function registerRequests(plugin: Plugin) {
  plugin.registerView(REQUESTS_VIEW, (leaf) => new RequestsView(leaf))
  plugin.registerView(REQUEST_TAB_VIEW, (leaf) => new RequestTab(leaf))
  plugin.addCommand({
    id: 'open-requests',
    name: 'Open requests',
    callback: () => void openRequestsView(plugin.app),
  })
  plugin.register(() => RequestsService.destroy())
}

/** Opens the Requests view in the left sidebar, as Bookmarks sits there. */
export async function openRequestsView(obsidian: App = app()) {
  const { workspace } = obsidian
  const leaf = workspace.getLeavesOfType(REQUESTS_VIEW)[0] ?? workspace.getLeftLeaf(false)
  if (!leaf) return
  if (leaf.getViewState().type !== REQUESTS_VIEW)
    await leaf.setViewState({ type: REQUESTS_VIEW, active: true })
  await revealSidebarView(obsidian, REQUESTS_VIEW)
}
