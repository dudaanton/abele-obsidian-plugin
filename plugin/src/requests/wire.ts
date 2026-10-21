// What the node answers about saved requests (`http.v1.*`). The plugin reads through the generic
// request with its own schemas, mirroring AbeleNode's `packages/node-protocol/src/http.ts`, where
// unknown fields are dropped, not refused, so a newer node still reads.
import { z } from 'zod'

export const MethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
export type Method = z.infer<typeof MethodSchema>

export const PairSchema = z.object({
  key: z.string(),
  value: z.string(),
  off: z.boolean().optional(),
})
export type Pair = z.infer<typeof PairSchema>

export const RequestDocSchema = z.object({
  name: z.string(),
  method: MethodSchema,
  url: z.string(),
  params: z.array(PairSchema),
  headers: z.array(PairSchema),
  body: z.object({ format: z.enum(['json', 'text', 'form']), text: z.string() }).optional(),
  scripts: z.object({ before: z.string().optional(), after: z.string().optional() }),
  checks: z.array(z.string()),
})
export type RequestDoc = z.infer<typeof RequestDocSchema>

export const LastSchema = z.object({
  status: z.number().optional(),
  failed: z.boolean().optional(),
  unknown: z.boolean().optional(),
})

export const RequestSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  method: MethodSchema,
  url: z.string(),
  last: LastSchema.optional(),
})
export type RequestSummary = z.infer<typeof RequestSummarySchema>

export const ListSchema = z.object({
  folder: z.string(),
  collections: z.array(z.object({ name: z.string(), requests: z.array(RequestSummarySchema) })),
  environments: z.array(z.string()),
})
export type RequestList = z.infer<typeof ListSchema>

export const VarSchema = z.object({
  key: z.string(),
  value: z.string().optional(),
  secret: z.boolean().optional(),
  off: z.boolean().optional(),
})
export type EnvVar = z.infer<typeof VarSchema>

export const EnvironmentSchema = z.object({
  name: z.string(),
  vars: z.array(VarSchema),
  step_header: z.boolean().optional(),
  local: z.array(z.string()).optional(),
})
export type EnvironmentDoc = z.infer<typeof EnvironmentSchema>

export const ResponseSchema = z.object({
  status: z.number(),
  reason: z.string(),
  ms: z.number(),
  bytes: z.number(),
  headers: z.array(z.object({ key: z.string(), value: z.string() })),
  body: z.string(),
  more: z.boolean().optional(),
  cut: z.boolean().optional(),
})
export type WireResponse = z.infer<typeof ResponseSchema>

export const OutcomeSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('sending') }),
  z.object({ state: z.literal('answered'), response: ResponseSchema }),
  z.object({ state: z.literal('failed'), reason: z.string() }),
  z.object({ state: z.literal('unknown'), reason: z.string(), after_ms: z.number() }),
])
export type WireOutcome = z.infer<typeof OutcomeSchema>

export const SendSummarySchema = z.object({
  id: z.string(),
  at: z.string(),
  environment: z.string().optional(),
  method: MethodSchema,
  url: z.string(),
  status: z.number().optional(),
  failed: z.boolean().optional(),
  unknown: z.boolean().optional(),
  ms: z.number().optional(),
  bytes: z.number().optional(),
  run: z.object({ run_id: z.string(), step: z.string().optional() }).optional(),
})
export type SendSummary = z.infer<typeof SendSummarySchema>

export const SendStatusSchema = z.object({
  send: SendSummarySchema,
  outcome: OutcomeSchema,
  code_steps: z.number().optional(),
})
export type SendStatus = z.infer<typeof SendStatusSchema>

export interface OutgoingSend {
  requestId?: string
  environment?: string
  method: Method
  url: string
  headers: { key: string; value: string }[]
  body?: string
  /** Values the node blanks wherever they show; never written. */
  secrets: string[]
  timeoutMs?: number
  /** Into the recording of this debugger session. */
  debugSessionId?: string
  stepHeader?: boolean
  routeByDestination?: boolean
}

/** The `http.v1` methods over a node connection's generic request; every answer is validated. */
export class HttpRpc {
  constructor(private readonly request: (method: string, params: unknown) => Promise<unknown>) {}
  async destination(projectId: string, url: string) {
    return z
      .object({
        debug_session_id: z.string().nullable(),
        candidates: z.array(z.string()),
        reason: z.enum(['remote', 'owned', 'ambiguous', 'unobserved']),
      })
      .parse(await this.request('http.v1.destination', { project_id: projectId, url }))
  }
  async list(projectId: string) {
    return ListSchema.parse(await this.request('http.v1.list', { project_id: projectId }))
  }
  async get(projectId: string, id: string) {
    return z
      .object({ id: z.string(), request: RequestDocSchema })
      .parse(await this.request('http.v1.request.get', { project_id: projectId, id })).request
  }
  async save(
    projectId: string,
    id: string,
    request: RequestDoc,
    options: { from?: string; create?: boolean } = {}
  ) {
    await this.request('http.v1.request.save', {
      project_id: projectId,
      id,
      request,
      ...(options.from ? { from: options.from } : {}),
      ...(options.create ? { create: true } : {}),
    })
  }
  async remove(projectId: string, id: string) {
    await this.request('http.v1.request.delete', { project_id: projectId, id })
  }
  async createCollection(projectId: string, name: string) {
    await this.request('http.v1.collection.create', { project_id: projectId, name })
  }
  async environment(projectId: string, name: string) {
    return EnvironmentSchema.parse(
      await this.request('http.v1.env.get', { project_id: projectId, name })
    )
  }
  async saveEnvironment(projectId: string, environment: Omit<EnvironmentDoc, 'local'>) {
    return EnvironmentSchema.parse(
      await this.request('http.v1.env.save', {
        project_id: projectId,
        environment: {
          name: environment.name,
          vars: environment.vars,
          ...(environment.step_header ? { step_header: true } : {}),
        },
      })
    )
  }
  async removeEnvironment(projectId: string, name: string) {
    await this.request('http.v1.env.delete', { project_id: projectId, name })
  }
  async send(projectId: string, send: OutgoingSend) {
    return z.object({ send_id: z.string(), run_id: z.string().optional() }).parse(
      await this.request('http.v1.send', {
        project_id: projectId,
        ...(send.requestId ? { request_id: send.requestId } : {}),
        ...(send.environment ? { environment: send.environment } : {}),
        method: send.method,
        url: send.url,
        headers: send.headers,
        ...(send.body !== undefined ? { body: send.body } : {}),
        secrets: send.secrets,
        ...(send.timeoutMs ? { timeout_ms: send.timeoutMs } : {}),
        ...(send.debugSessionId ? { debug_session_id: send.debugSessionId } : {}),
        ...(send.stepHeader ? { step_header: true } : {}),
        ...(send.routeByDestination ? { route_by_destination: true } : {}),
      })
    )
  }
  async status(projectId: string, sendId: string) {
    return SendStatusSchema.parse(
      await this.request('http.v1.send.status', { project_id: projectId, send_id: sendId })
    )
  }
  async history(projectId: string, id: string, limit?: number) {
    return z.object({ sends: z.array(SendSummarySchema) }).parse(
      await this.request('http.v1.history', {
        project_id: projectId,
        id,
        ...(limit ? { limit } : {}),
      })
    ).sends
  }
  async body(projectId: string, sendId: string, from?: number) {
    return z.object({ text: z.string(), next: z.number().optional(), bytes: z.number() }).parse(
      await this.request('http.v1.body', {
        project_id: projectId,
        send_id: sendId,
        ...(from ? { from } : {}),
      })
    )
  }
}

const HttpDescription = z.object({
  capabilities: z.object({
    capabilities: z.object({
      http_v1: z
        .object({
          status: z.string(),
          destination_owner: z.boolean().optional(),
          recording_correlation: z.boolean().optional(),
        })
        .optional(),
    }),
  }),
})
export function httpRecordingCapabilities(description: unknown) {
  const r = HttpDescription.safeParse(description)
  const flags = r.success ? r.data.capabilities.capabilities.http_v1 : undefined
  return {
    destination: flags?.status === 'supported' && flags.destination_owner === true,
    correlation: flags?.status === 'supported' && flags.recording_correlation === true,
  }
}
/** Saved requests are offered where the node says it keeps and sends them. */
export function nodeHttpSupported(description: unknown): boolean {
  const r = HttpDescription.safeParse(description)
  return r.success && r.data.capabilities.capabilities.http_v1?.status === 'supported'
}
