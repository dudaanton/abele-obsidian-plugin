import { t } from '@/i18n'
// The saved requests in Obsidian: a view of their own in the left sidebar, as Bookmarks, and each
// request a tab of the main area, its answer beside it. Both read one model per project; neither
// keeps a request in the saved layout, only where it is: the node, the project and the file.
import {
  ItemView,
  Menu,
  Notice,
  type App,
  type Plugin,
  type ViewStateResult,
  type WorkspaceLeaf,
} from 'obsidian'
import { computed, defineComponent, h, onMounted, shallowRef, watch } from 'vue'
import { z } from 'zod'
import RequestsPanel from '@/components/debugger/http/RequestsPanel.vue'
import RequestView from '@/components/debugger/http/RequestView.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import { mountKit, type KitMount } from '@/components/obsidian/mount'
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
  remove,
  rename,
  requestMenu,
  revealRequest,
  say,
  sendFromView,
} from './actions'
import { keyPort, RequestsService, RequestsContextSchema } from './RequestsService'
import type { RequestsModel } from './RequestsModel'
import { addressOf, pairsForView } from './resolve'
import type { Pair, RequestDoc } from './wire'
import { ScriptService } from '@/scripting/ScriptService'
import { RequestScriptPicker } from '@/components/debugger/http/RequestScriptPicker'
import { assignRequestScript, requestScriptProblems, type ScriptMoment } from './scripts'
import { SECRET_NAME } from './importers/shared'
import { NodeRequestFiles } from './nodeFiles'
import { collectionOf, originOf, sentAtWords, reasonOf } from './shapes'
import { DebuggerService } from '@/debugger/DebuggerService'

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
export function shownVars(model: RequestsModel, doc: RequestDoc): HttpPair[] {
  const file = Object.entries(model.state.entries).some(
    ([id, entry]) => entry.doc === doc && !!model.files?.get(id)
  )
  return Object.entries(model.vars(doc, true)).map(([key, value]) => {
    const hasKey = /\$\{abele_key:[^}]+\}/.test(value)
    const namedKey = /^\$\{abele_key:[^}]+\}$/.test(value)
    const secret =
      !!model.state.env?.vars.find((v) => v.key === key)?.secret ||
      ((file || !!model.files?.wasEnvironment(model.state.environment)) && SECRET_NAME.test(key))
    return {
      key,
      value: secret && !namedKey ? '••••' : value,
      ...(secret || hasKey ? { secret: true } : {}),
    }
  })
}

// ── The sidebar view ──

const Sidebar = defineComponent({
  setup() {
    const service = RequestsService.instance()
    const context = service.context
    const model = computed(() => (context.value ? service.model(context.value) : undefined))
    const connection = computed(() => {
      const c = context.value
      if (!c) return undefined
      try {
        return NodeService.getInstance().connection(c.registrationId)
      } catch {
        return undefined
      }
    })
    const recording = computed(() =>
      context.value ? service.recording(context.value).value : undefined
    )
    const load = (): void => {
      void model.value?.load().catch(() => {})
    }
    onMounted(load)
    watch(context, load)
    watch(
      model,
      (current, _previous, cleanup) => {
        if (current)
          cleanup(current.followList(() => connection.value?.state.value === 'connected'))
      },
      { immediate: true }
    )
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
      for (const collection of m?.files?.collections ?? [])
        collections.push({
          name: collection.name,
          file: collection.file,
          requests: collection.requests.map((r) => ({
            ...viewRequest(r.id, m?.state.entries[r.id]?.doc ?? r.doc),
            origin: r.origin,
            ...(m?.entry(r.id).outcome?.kind === 'answered'
              ? {
                  last: {
                    status: (
                      m.entry(r.id).outcome as Extract<
                        import('@/components/debugger/http/types').HttpOutcome,
                        { kind: 'answered' }
                      >
                    ).response.status,
                  },
                }
              : {}),
          })),
        })
      const open = service.openRequest.value
      return h(RequestsPanel, {
        collections,
        environment: m?.state.environment,
        offline,
        notice,
        project: c ? (c.label ?? c.projectId) : '',
        node: c?.node,
        open:
          open && c && open.projectId === c.projectId && open.worktreeId === c.worktreeId
            ? open.id
            : undefined,
        sending: m?.state.sending.at(-1),
        recording: recording.value?.name,
        onRefresh: load,
        onSendAll: (path: string): void => {
          void m?.sendAll(path, { interactive: true }).catch(say)
        },
        onOpenFile: (path: string, line: number): void => {
          if (m?.files?.port instanceof NodeRequestFiles)
            void m.files.port.open(path, line).catch(say)
        },
        reveal: service.reveal.value,
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
  private vue?: KitMount
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
    this.vue = mountKit(this.contentEl, Sidebar, null, { owner: this })
  }
  async onClose() {
    this.vue?.unmount()
    this.vue = undefined
  }
}

// ── A request's tab ──

const TabState = RequestsContextSchema.pick({
  registrationId: true,
  projectId: true,
  worktreeId: true,
}).extend({
  id: z.string().min(1),
})
type TabState = z.infer<typeof TabState>

export class RequestTab extends ItemView {
  private readonly current = shallowRef<TabState>()
  private vue?: KitMount
  private reading?: Promise<void>
  private retryRead = false
  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    // Obsidian puts each action before the last: added right to left, they read terminal,
    // duplicate, reveal, then its own ⋯, where Rename and Delete are.
    this.addAction('locate', 'Reveal in collection', () => {
      const s = this.current.value
      if (s) void revealRequest(s, s.id).catch(say)
    })
    this.addAction('copy-plus', 'Duplicate', () => {
      const s = this.current.value
      if (s)
        void RequestsService.instance()
          .model(s)
          .duplicate(s.id)
          .then((copy) => openRequestTab(s, copy))
          .catch(say)
    })
    this.addAction('terminal', 'Copy as curl', () => {
      const s = this.current.value
      if (s) void copyCurl(RequestsService.instance().model(s), s.id).catch(say)
    })
  }
  onPaneMenu(menu: Menu, source: string) {
    const s = this.current.value
    if (s && !s.id.startsWith('file:')) {
      menu.addItem((i) =>
        i
          .setTitle('Rename')
          .setIcon('pencil')
          .setSection('action')
          .onClick(() => void rename(s, s.id).catch(say))
      )
      menu.addItem((i) =>
        i
          .setTitle('Delete')
          .setIcon('trash-2')
          .setSection('danger')
          .setWarning(true)
          .onClick(() => void remove(s, s.id).catch(say))
      )
    }
    super.onPaneMenu(menu, source)
  }
  getViewType() {
    return REQUEST_TAB_VIEW
  }
  getDisplayText() {
    const s = this.current.value
    if (!s) return 'Request'
    const name =
      RequestsService.instance().model(s).entry(s.id).doc?.name ??
      s.id
        .split('/')
        .pop()
        .replace(/\.http$/, '')
    return collectionOf(s.id) ? `${name} · ${collectionOf(s.id)}` : name
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
      if (
        was?.id !== parsed.data.id ||
        was.projectId !== parsed.data.projectId ||
        was.worktreeId !== parsed.data.worktreeId ||
        !RequestsService.instance().model(parsed.data).entry(parsed.data.id).doc
      )
        this.read()
    }
    await super.setState(raw, result)
  }
  async onOpen() {
    this.draw()
    this.register(
      watch(
        this.current,
        (s, _was, cleanup) => {
          if (s) {
            const model = RequestsService.instance().model(s)
            cleanup(model.followFiles())
            try {
              const connection = NodeService.getInstance().connection(s.registrationId)
              cleanup(
                watch([connection.state, connection.healthEpoch], () => {
                  if (
                    this.retryRead &&
                    connection.state.value === 'connected' &&
                    !model.entry(s.id).doc
                  )
                    this.read()
                })
              )
            } catch (error) {
              console.debug('[requests] Request connection unavailable', error)
            }
          }
        },
        { immediate: true }
      )
    )
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
    if (!s || this.reading) return
    this.retryRead = false
    RequestsService.instance().openRequest.value = s
    const model = RequestsService.instance().model(s)
    const ready =
      model.state.environments.length || model.state.collections.length
        ? Promise.resolve()
        : model.load()
    this.reading = ready
      .then(() => model.open(s.id))
      .then(() => this.header())
      .catch((e) => {
        this.retryRead =
          /outcome_unknown|disconnected|timeout|timed_out|unreachable|connection_failed/.test(
            `${(e as { code?: string })?.code ?? ''} ${e instanceof Error ? e.message : String(e)}`
          )
        model.entry(s.id).error = reasonOf(e)
        console.debug('[requests] Request not read', e)
      })
      .finally(() => {
        this.reading = undefined
        const current = this.current.value
        if (
          current &&
          (current.id !== s.id ||
            current.projectId !== s.projectId ||
            current.registrationId !== s.registrationId ||
            current.worktreeId !== s.worktreeId)
        )
          this.read()
      })
  }
  private draw() {
    this.contentEl.replaceChildren()
    this.contentEl.addClass('abele-request-tab')
    const current = this.current
    const header = () => this.header()
    this.vue = mountKit(
      this.contentEl,
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
            const recording = service.recording(s, originOf(addressOf(doc, model.vars(doc)))).value
            const binding = DebuggerService.instance.active.value
            if (binding) void binding.revision.value
            const session =
              binding?.registrationId === s.registrationId &&
              binding.controller.snapshot?.target.project_id === s.projectId
                ? binding.controller.session
                : undefined
            const frame = session?.frames.find((f) => f.file)
            const pausedAt =
              session?.status === 'paused'
                ? frame
                  ? `${frame.file}:${frame.line}`
                  : undefined
                : undefined
            const outcome = entry.outcome
            const checks = outcome?.kind === 'answered' ? outcome.response.checks : undefined
            return h(RequestView, {
              request: {
                ...viewRequest(s.id, doc, checks),
                ...(model.files?.get(s.id) ? { origin: model.files.get(s.id)!.origin } : {}),
              },
              saveError: entry.error,
              gone: model.files?.get(s.id)?.gone,
              sourceScript: model.files?.get(s.id)?.script,
              captures: (model.files?.captures(s.id) ?? []).map((c) => ({
                ...c,
                ...(c.at ? { at: sentAtWords(c.at) } : {}),
              })),
              onSendFirst: (id: string): void => sendFromView(s, id),
              onOpenOrigin: (): void => {
                const file = model.files?.get(s.id)
                if (file && model.files?.port instanceof NodeRequestFiles)
                  void model.files.port.open(file.origin.file, file.origin.line).catch(say)
              },
              environment: model.state.environment ?? 'no environment',
              collection: collectionOf(s.id),
              vars: shownVars(model, doc),
              outcome,
              recorded: entry.runs.has(entry.shown ?? entry.history[0]?.id ?? ''),
              history: entry.history,
              shownSend: entry.shown,
              compareWith: entry.compare,
              recording: recording?.name,
              intoRecording: model.state.intoRecording,
              timeoutMs: model.timeout(s.id),
              pausedAt,
              paused: session?.status === 'paused',
              onTimeout: (ms: number): void => model.setTimeout(s.id, ms),
              onOpenDebugger: (): void => {
                void import('@/debugger/register').then((d) =>
                  revealSidebarView(app(), d.DEBUG_VIEW_TYPE)
                )
              },
              scriptProblems: requestScriptProblems(
                doc.scripts,
                ScriptService.getInstance().scriptList.value.map((s) => s.meta)
              ),
              onPickScript: (when: ScriptMoment): void => {
                const scripts = ScriptService.getInstance()
                new RequestScriptPicker(
                  app(),
                  scripts.scriptList.value.map((s) => s.meta),
                  when,
                  doc.scripts[when],
                  `${doc.name} ${when}`,
                  (name) => {
                    void assignRequestScript(model, s.id, when, name).catch(say)
                  },
                  (name) => {
                    void scripts
                      .createRequestScript(name)
                      .then((created) => assignRequestScript(model, s.id, when, created))
                      .catch(say)
                  }
                ).open()
              },
              onRemoveScript: (when: ScriptMoment): void => {
                void assignRequestScript(model, s.id, when, undefined).catch(say)
              },
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
              onOpenKeys: (): void => {
                void import('@/components/settings/settingsTab').then((m) =>
                  m.openAbeleSettings(app(), 'ai')
                )
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
  }
}

export function registerRequests(plugin: Plugin) {
  plugin.registerView(REQUESTS_VIEW, (leaf) => new RequestsView(leaf))
  plugin.registerView(REQUEST_TAB_VIEW, (leaf) => new RequestTab(leaf))
  plugin.addCommand({
    id: 'open-requests',
    name: t('commands.open-requests'),
    callback: () => void openRequestsView(plugin.app),
  })
  plugin.addCommand({
    id: 'import-requests',
    name: t('commands.import-requests'),
    callback: () => void importFromClipboard(),
  })
  plugin.register(() => RequestsService.destroy())
}

/** Opens the Requests view in the left sidebar, as Bookmarks sits there. */
export async function openRequestsView(obsidian: App = app(), pickOpenProject = true) {
  const { workspace } = obsidian
  if (pickOpenProject)
    RequestsService.instance().chooseOpenProject(
      workspace.getActiveViewOfType(ItemView)?.getState()
    )
  const leaf = workspace.getLeavesOfType(REQUESTS_VIEW)[0] ?? workspace.getLeftLeaf(false)
  if (!leaf) return
  if (leaf.getViewState().type !== REQUESTS_VIEW)
    await leaf.setViewState({ type: REQUESTS_VIEW, active: true })
  await revealSidebarView(obsidian, REQUESTS_VIEW)
  const service = RequestsService.instance()
  const context = service.context.value
  if (context) await service.model(context).load().catch(say)
}

/** A .http file, a curl line, a HAR file, an OpenAPI description or a Bruno request copied:
 * into the project the Requests view shows. */
let importing = false
export async function importFromClipboard() {
  if (importing) return
  const service = RequestsService.instance()
  const c = service.context.value
  if (!c) {
    new Notice('Choose a project in the requests view first')
    return
  }
  importing = true
  const progress = new Notice(t('debug.requestsImporting'), 0)
  try {
    const text = await navigator.clipboard.readText()
    const { importRequests } = await import('./importers')
    const { importInto, importWords } = await import('./importInto')
    const model = service.model(c)
    const outcome = await importInto(model, importRequests(text))
    // The view shows what came in: its collection unfolded, the new rows in sight.
    await openRequestsView(app(), false)
    const main = outcome.collections[0]
    if (main)
      service.reveal.value = {
        collection: main,
        ids: outcome.made.filter((id) => id.startsWith(`${main}/`)),
        at: Date.now(),
      }
    new Notice(importWords(outcome, model.state.environment), 10000)
  } catch (e) {
    say(e, 'Nothing imported')
  } finally {
    importing = false
    progress.hide()
  }
}
