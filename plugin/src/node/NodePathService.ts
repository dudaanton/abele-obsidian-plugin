import { UiError, uiMessage } from '@/i18n/streamBErrors'
import { watch, type WatchStopHandle } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { NodeService } from './NodeService'
import { NodePathModel } from './NodePathModel'
import { githubForge } from './nodePathForge'
import { NodePathClientPort } from './NodePathClientPort'
import { NodePathSnapshotSchema } from './nodePathSnapshot'

/** Device-local lifetime: tabs and the drawer share metadata, never each other's selection. */
export class NodePathService {
  private static instance?: NodePathService
  static getInstance(): NodePathService {
    return (this.instance ??= new NodePathService())
  }
  static destroyCurrent(): void {
    this.instance?.destroy()
    this.instance = undefined
  }
  private models = new Map<string, NodePathModel>()
  private stops = new Map<string, WatchStopHandle>()
  private loads = new Map<string, Promise<void>>()
  private cacheStops = new Map<string, WatchStopHandle>()
  private debugStops = new Map<string, WatchStopHandle>()
  private readonly seen = new Map<string, string>()
  private stopNodes: WatchStopHandle
  private constructor() {
    const app = GlobalStore.getInstance().app
    const saved: unknown = app.loadLocalStorage('abele-node-path-seen')
    if (saved && typeof saved === 'object' && !Array.isArray(saved))
      for (const [key, id] of Object.entries(saved))
        if (typeof id === 'string') this.seen.set(key, id)
    this.stopNodes = watch(NodeService.getInstance().nodes, (nodes) => {
      for (const [id, model] of this.models)
        if (!nodes.some((n) => n.id === id)) {
          model.destroy()
          this.models.delete(id)
          this.stops.get(id)?.()
          this.stops.delete(id)
          this.loads.delete(id)
          this.cacheStops.get(id)?.()
          this.cacheStops.delete(id)
          this.debugStops.get(id)?.()
          this.debugStops.delete(id)
          app.saveLocalStorage(`abele-node-path-cache:${id}`, null)
        }
    })
  }
  model(registrationId: string): NodePathModel {
    const existing = this.models.get(registrationId)
    if (existing) return existing
    const service = NodeService.getInstance(),
      node = service.nodes.value.find((n) => n.id === registrationId)
    if (!node) throw new UiError(uiMessage('streamBError.29f8c77828'))
    const connection = service.connection(registrationId)
    const port = new NodePathClientPort(
      connection.client,
      { nodeId: node.expectedNodeId, registrationId },
      githubForge
    )
    const model = new NodePathModel(node.expectedNodeId, registrationId, port, {
      get: (key) => this.seen.get(key),
      set: (key, id) => {
        this.seen.set(key, id)
        if (this.seen.size > 4096) this.seen.delete(this.seen.keys().next().value!)
        GlobalStore.getInstance().app.saveLocalStorage(
          'abele-node-path-seen',
          Object.fromEntries(this.seen)
        )
      },
    })
    model.online.value = connection.state.value === 'connected'
    const app = GlobalStore.getInstance().app,
      cacheKey = `abele-node-path-cache:${registrationId}`
    model.restoreSnapshot(app.loadLocalStorage(cacheKey))
    this.cacheStops.set(
      registrationId,
      watch(
        [
          model.folders,
          model.targets,
          model.inspections,
          model.selected,
          model.receivedAt,
          model.panelBase,
        ],
        () => {
          const parsed = NodePathSnapshotSchema.safeParse(model.snapshot())
          if (parsed.success && JSON.stringify(parsed.data).length <= 1024 * 1024)
            app.saveLocalStorage(cacheKey, parsed.data)
        }
      )
    )
    this.models.set(registrationId, model)
    this.debugStops.set(
      registrationId,
      watch(model.selected, () => {
        const target = model.current.value
        if (!target) return
        void import('@/debugger/DebuggerService').then(({ DebuggerService }) => {
          if (this.models.get(registrationId) === model && model.current.value === target)
            DebuggerService.instance.selectFolder(target)
        })
      })
    )
    this.stops.set(
      registrationId,
      watch(
        () => [connection.state.value, connection.healthEpoch?.value] as const,
        ([state], previous) => {
          model.online.value = state === 'connected'
          if (state === 'connected') model.connectionRecovered()
          if (state === 'connected' && previous?.[0] !== 'connected')
            void model
              .reconnected()
              .then(async () => {
                if (
                  connection.state.value !== 'connected' ||
                  this.models.get(registrationId) !== model
                )
                  return
                // reconnected() re-lists, drops the previous process's handles and reselects;
                // panels that read their own lists reload after it.
                if (model.panelMode.value === 'history') await model.loadPanelHistory()
                if (model.panelMode.value === 'pulls') await model.loadPanelPulls()
              })
              .catch((e) => model.report(e))
        }
      )
    )
    this.loads.set(
      registrationId,
      connection
        .connect()
        .then(() => model.start())
        .catch((e) => model.report(e))
    )
    return model
  }
  ready(registrationId: string): Promise<void> {
    this.model(registrationId)
    return this.loads.get(registrationId) ?? Promise.resolve()
  }
  destroy(): void {
    this.stopNodes()
    for (const stop of this.stops.values()) stop()
    for (const stop of this.cacheStops.values()) stop()
    for (const stop of this.debugStops.values()) stop()
    for (const model of this.models.values()) model.destroy()
    this.stops.clear()
    this.models.clear()
    this.loads.clear()
    this.cacheStops.clear()
    this.debugStops.clear()
  }
}
