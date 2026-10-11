import { watch, type WatchStopHandle } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { NodeService } from './NodeService'
import { NodePathModel } from './NodePathModel'
import { NodePathClientPort } from './NodePathClientPort'

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
        }
    })
  }
  model(registrationId: string): NodePathModel {
    const existing = this.models.get(registrationId)
    if (existing) return existing
    const service = NodeService.getInstance(),
      node = service.nodes.value.find((n) => n.id === registrationId)
    if (!node)
      throw new Error('This node registration is missing. Reconnect it from the Node panel.')
    const connection = service.connection(registrationId)
    const port = new NodePathClientPort(connection.client, {
      nodeId: node.expectedNodeId,
      registrationId,
    })
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
    this.models.set(registrationId, model)
    this.stops.set(
      registrationId,
      watch(connection.state, (state) => {
        if (state === 'connected') void model.refresh().catch((e) => model.report(e))
      })
    )
    void connection
      .connect()
      .then(() => model.start())
      .catch((e) => model.report(e))
    return model
  }
  destroy(): void {
    this.stopNodes()
    for (const stop of this.stops.values()) stop()
    for (const model of this.models.values()) model.destroy()
    this.stops.clear()
    this.models.clear()
  }
}
