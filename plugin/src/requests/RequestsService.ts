// Where the saved requests meet Obsidian: which project of which node the Requests view shows, the
// key store, the scripts, the recording going on and the choices remembered on this device. One
// model per project, shared by the view and every request tab of it, and by the agent's tools.
import { computed, shallowRef, type ComputedRef } from 'vue'
import { z } from 'zod'
import { NodeService } from '@/node/NodeService'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DebuggerService } from '@/debugger/DebuggerService'
import {
  prepareSecretRequest,
  secretNames,
  secretRequestInfo,
  type SecretRequest,
} from '@/ai/tools/secretUtils'
import { RequestsModel, forgetRequestSecrets, type RequestsPorts } from './RequestsModel'
import type { Outgoing } from './resolve'
import { HttpRpc, nodeHttpSupported } from './wire'

export const RequestsContextSchema = z.object({
  registrationId: z.string().min(1),
  projectId: z.string().min(1),
  /** The project's folder name, to say which it is. */
  label: z.string().optional(),
  node: z.string().optional(),
})
export type RequestsContext = z.infer<typeof RequestsContextSchema>

const CONTEXT_KEY = 'abele-requests-context'

const key = (c: Pick<RequestsContext, 'registrationId' | 'projectId'>) =>
  JSON.stringify([c.registrationId, c.projectId])

/** The node's requests over its connection, looked up only when a request is made: a node
 * removed since says so then, instead of breaking whatever holds the model. */
export function rpcFor(registrationId: string) {
  return {
    rpc: new HttpRpc(async (method, params) => {
      const connection = NodeService.getInstance().connection(registrationId)
      await connection.connect()
      return connection.client.request(method, params)
    }),
  }
}

/** Whether this device still has the node a project was chosen on. */
export function nodeKnown(registrationId: string) {
  return NodeService.getInstance().nodes.value.some((n) => n.id === registrationId)
}

/** Keys by name from the plugin's key store; the owner allows an address the way scripts do. */
export const keyPort: RequestsPorts['keys'] = {
  has: (name) => !!AbeleConfig.getInstance().ai?.secrets?.some((s) => s.name === name && !!s.keyId),
  async prepare(out: Outgoing, interactive: boolean, signal?: AbortSignal) {
    const request: SecretRequest = { url: out.url, headers: out.headers, body: out.body }
    if (!secretNames(request).length) return { out, secrets: [] }
    if (interactive) {
      const { approveScriptKeyRequest } = await import('@/secrets/requestApproval')
      await approveScriptKeyRequest(request, signal)
    } else if (secretRequestInfo(request).missing.length)
      throw new Error(
        `A key in this request is not allowed at ${secretRequestInfo(request).origin} yet. Send it once from its tab to allow the address.`
      )
    const prepared = prepareSecretRequest(request)
    return {
      out: {
        ...out,
        url: prepared.url,
        headers: prepared.headers,
        ...(prepared.body !== undefined ? { body: prepared.body } : {}),
      },
      secrets: prepared.secretValues,
    }
  },
}

/** Plugin scripts by the name they declare, with the confirmation rules every script has. */
export const scriptPort: RequestsPorts['scripts'] = {
  async run(name, input, interactive, signal) {
    const { findScriptByName } = await import('@/scripting/runScript')
    const { ScriptService } = await import('@/scripting/ScriptService')
    const script = findScriptByName(name)
    if (!script) throw new Error(`There is no script named ${name}`)
    // Checked before anything asks to confirm it: a request's file may come from anyone writing
    // in the project, so it can name only a script made to run around requests.
    if (!script.meta.request || script.meta.interceptor)
      throw new Error(`Script ${name} does not run around requests: it needs a @request line`)
    const value = await ScriptService.getInstance().forRequest(
      script.path,
      { ...input },
      interactive,
      signal
    )
    if (!value || typeof value !== 'object') return undefined
    const v = value as { request?: unknown; vars?: unknown }
    const vars =
      v.vars && typeof v.vars === 'object'
        ? Object.fromEntries(
            Object.entries(v.vars as Record<string, unknown>)
              .filter(([, x]) => x !== undefined && x !== null)
              .map(([k, x]) => [k, typeof x === 'string' ? x : JSON.stringify(x)])
          )
        : undefined
    const r =
      v.request && typeof v.request === 'object' ? (v.request as Partial<Outgoing>) : undefined
    return {
      ...(vars ? { vars } : {}),
      ...(r
        ? {
            request: {
              ...(typeof r.url === 'string' ? { url: r.url } : {}),
              ...(typeof r.method === 'string'
                ? { method: r.method.toUpperCase() as Outgoing['method'] }
                : {}),
              ...(r.headers && typeof r.headers === 'object'
                ? {
                    headers: Object.fromEntries(
                      Object.entries(r.headers).map(([k, x]) => [k, String(x)])
                    ),
                  }
                : {}),
              ...(typeof r.body === 'string' ? { body: r.body } : {}),
            },
          }
        : {}),
    }
  },
}

/** The program being recorded in this project of this node, if the debugger shows one. */
export function recordingOf(c: Pick<RequestsContext, 'registrationId' | 'projectId'>) {
  const binding = DebuggerService.instance.active.value
  if (!binding || binding.registrationId !== c.registrationId) return undefined
  void binding.revision.value
  const snapshot = binding.controller.snapshot
  if (!snapshot || snapshot.target.project_id !== c.projectId) return undefined
  if (!binding.trace?.status?.recording || !binding.sessionId) return undefined
  return { sessionId: binding.sessionId, name: snapshot.target.launch_configuration_id }
}

export class RequestsService {
  private static current?: RequestsService
  static instance() {
    return (this.current ??= new RequestsService())
  }
  static destroy() {
    this.current = undefined
    forgetRequestSecrets()
  }

  private readonly models = new Map<string, RequestsModel>()
  /** The request whose tab was looked at last: the view marks it, a new request goes beside it. */
  readonly openRequest = shallowRef<{ registrationId: string; projectId: string; id: string }>()
  private readonly chosen = shallowRef<RequestsContext | undefined>(this.remembered())
  /** The project the Requests view shows; none once its node has been removed from this device. */
  readonly context = computed(() => {
    const c = this.chosen.value
    return c && nodeKnown(c.registrationId) ? c : undefined
  })

  private remembered(): RequestsContext | undefined {
    try {
      const raw = GlobalStore.getInstance().app.loadLocalStorage(CONTEXT_KEY) as unknown
      const parsed = RequestsContextSchema.safeParse(
        typeof raw === 'string' ? JSON.parse(raw) : raw
      )
      return parsed.success ? parsed.data : undefined
    } catch {
      return undefined
    }
  }

  choose(c: RequestsContext) {
    this.chosen.value = c
    GlobalStore.getInstance().app.saveLocalStorage(CONTEXT_KEY, JSON.stringify(c))
  }

  model(c: Pick<RequestsContext, 'registrationId' | 'projectId'>): RequestsModel {
    const k = key(c)
    let model = this.models.get(k)
    if (!model) {
      const app = GlobalStore.getInstance().app
      const prefix = `abele-requests:${c.registrationId}:${c.projectId}:`
      model = new RequestsModel(rpcFor(c.registrationId).rpc, c.projectId, {
        keys: keyPort,
        scripts: scriptPort,
        recording: () => recordingOf(c),
        prefs: {
          get: (name) => {
            const v = app.loadLocalStorage(prefix + name) as unknown
            return typeof v === 'string' ? v : undefined
          },
          set: (name, value) => app.saveLocalStorage(prefix + name, value),
        },
      })
      this.models.set(k, model)
    }
    return model
  }

  /** Reactive: the recording going on in this project, for the view's quiet line and the switch. */
  recording(
    c: Pick<RequestsContext, 'registrationId' | 'projectId'>
  ): ComputedRef<{ sessionId: string; name: string } | undefined> {
    return computed(() => recordingOf(c))
  }

  /** Every project of every node that keeps saved requests, the connected nodes first. */
  async contexts(): Promise<RequestsContext[]> {
    const service = NodeService.getInstance()
    const out: RequestsContext[] = []
    for (const node of service.nodes.value) {
      const connection = service.connection(node.id)
      try {
        await connection.connect()
        if (!nodeHttpSupported(await connection.client.describe())) continue
        let after: string | undefined
        for (let page = 0; page < 64; page++) {
          const batch = await connection.client.listProjects(after)
          for (const p of batch)
            out.push({
              registrationId: node.id,
              projectId: p.project_id,
              label: p.root_path.split(/[\\/]/).filter(Boolean).pop() ?? p.root_path,
              node: node.label,
            })
          if (batch.length < 100) break
          const next = batch.at(-1).project_id
          if (next === after) break
          after = next
        }
      } catch (e) {
        console.debug('[requests] Node not listed', node.id, e)
      }
    }
    return out
  }
}
