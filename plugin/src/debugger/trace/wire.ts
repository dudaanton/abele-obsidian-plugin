// What the node answers about recorded runs (`trace.v1.*`). The vendored node protocol has its own
// schemas for these, but they refuse any field they do not know; the plugin reads through the
// generic request with its own, mirroring AbeleNode's `packages/node-protocol/src/trace.ts`, where
// unknown fields are dropped, not refused, so a newer node still reads.
import { z } from 'zod'

export interface WireShape {
  key?: string
  type: string
  count?: number
  optional?: boolean
  example?: string
  children?: WireShape[]
}
export const WireShapeSchema: z.ZodType<WireShape> = z.lazy(() =>
  z.object({
    key: z.string().optional(),
    type: z.string(),
    count: z.number().optional(),
    optional: z.boolean().optional(),
    example: z.string().optional(),
    children: z.array(WireShapeSchema).optional(),
  })
)

export const WireValueSchema = z.object({
  name: z.string(),
  format: z.enum(['json', 'xml', 'text', 'number']),
  bytes: z.number(),
  brief: z.string(),
  same: z.boolean().optional(),
  masked: z.boolean().optional(),
  failed: z.string().optional(),
})
export type WireValue = z.infer<typeof WireValueSchema>

/** Step identities are the node's own `t0001`; nothing else is taken for one. */
const stepId = z.string().regex(/^t\d{4,9}$/)

export const WireStepSchema = z.object({
  id: stepId,
  kind: z.enum(['probe', 'error', 'http', 'browser-lost']),
  ts: z.string(),
  at: z.number(),
  label: z.string(),
  point: z.string().optional(),
  place: z.object({ file: z.string(), line: z.number(), fn: z.string().optional() }).optional(),
  stack: z.array(z.string()).optional(),
  paused_ms: z.number().optional(),
  direction: z.enum(['incoming', 'outgoing']).optional(),
  duration_ms: z.number().nonnegative().optional(),
  status: z.number().optional(),
  host: z.string().optional(),
  chain: z.string().optional(),
  /** Under its request only because it ran while the request was out. */
  by_time: z.boolean().optional(),
  /** A request sent from the project's saved requests. */
  sent: z.boolean().optional(),
  marked: z.boolean().optional(),
  values: z.array(WireValueSchema),
})
export type WireStep = z.infer<typeof WireStepSchema>

export const WireRunSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  debug_session_id: z.string(),
  started_at: z.string(),
  length_ms: z.number().optional(),
  state: z.enum(['recording', 'done', 'cut']),
  steps: z.number(),
  bytes: z.number(),
})
export type WireRunSummary = z.infer<typeof WireRunSummarySchema>

export const WirePointSchema = z.object({
  breakpoint_id: z.string(),
  take: z.array(z.string()),
  note: z.string().optional(),
})
export type WirePoint = z.infer<typeof WirePointSchema>

export const WireRunPointSchema = z.object({
  breakpoint_id: z.string(),
  file: z.string(),
  line: z.number(),
  take: z.array(z.string()),
  when: z.string().optional(),
  note: z.string().optional(),
  hits: z.number(),
  last: z.string().optional(),
})
export type WireRunPoint = z.infer<typeof WireRunPointSchema>

export const WireMarkSchema = z.object({
  step: stepId,
  name: z.string().optional(),
  path: z.string().optional(),
  comment: z.string(),
  tags: z.array(z.string()).optional(),
  at: z.string().optional(),
})
export type WireMark = z.infer<typeof WireMarkSchema>

export const WireRunSchema = z.object({
  run: WireRunSummarySchema,
  points: z.array(WireRunPointSchema),
  steps: z.array(WireStepSchema),
  next: z.number().optional(),
  marks: z.array(WireMarkSchema),
  folder: z.string(),
})
export type WireRun = z.infer<typeof WireRunSchema>

export const WirePageSchema = z.object({
  lines: z.array(z.string()),
  next: z.number().optional(),
  truncated: z.boolean(),
  total: z.number(),
})
export type WirePage = z.infer<typeof WirePageSchema>

export const WireChangeSchema = z.object({
  path: z.string(),
  kind: z.enum(['added', 'removed', 'type', 'value']),
  before: z.string().optional(),
  after: z.string().optional(),
  count: z.number(),
})

export const WireValueResultSchema = z.object({
  value: WireValueSchema,
  shape: WireShapeSchema.optional(),
  page: WirePageSchema.optional(),
  changes: z
    .object({
      against: z.object({ step: z.string(), name: z.string() }),
      summary: z.string(),
      changes: z.array(WireChangeSchema),
    })
    .optional(),
})
export type WireValueResult = z.infer<typeof WireValueResultSchema>

export const WireFolderSchema = z.object({ folder: z.string(), chosen: z.boolean() })
export const WireStatusSchema = WireFolderSchema.extend({
  recording: z.object({ run_id: z.string(), steps: z.number(), started_at: z.string() }).nullable(),
})
export type WireStatus = z.infer<typeof WireStatusSchema>
export const WireTrailSchema = z.object({
  value: z.string(),
  stops: z.array(
    z.object({
      step: z.string(),
      name: z.string(),
      path: z.string(),
      change: z.string().optional(),
    })
  ),
  lost_after: z.string().optional(),
})
export type WireTrail = z.infer<typeof WireTrailSchema>
export const WireHitSchema = z.object({ step: z.string(), name: z.string(), path: z.string() })
export type WireHit = z.infer<typeof WireHitSchema>

export type TraceView = 'shape' | 'page' | 'slice' | 'changes'
export type TraceCap = 'panel' | 'agent'

/** The trace methods over a node connection's generic request; every answer is validated. */
export class TraceRpc {
  constructor(private readonly request: (method: string, params: unknown) => Promise<unknown>) {}
  async points(debugSessionId: string) {
    return z
      .object({ points: z.array(WirePointSchema) })
      .parse(await this.request('trace.v1.points.list', { debug_session_id: debugSessionId }))
      .points
  }
  async setPoints(debugSessionId: string, upsert: WirePoint[], remove: string[]) {
    return z.object({ points: z.array(WirePointSchema) }).parse(
      await this.request('trace.v1.points.set', {
        debug_session_id: debugSessionId,
        upsert,
        remove,
      })
    ).points
  }
  async status(debugSessionId: string) {
    return WireStatusSchema.parse(
      await this.request('trace.v1.status', { debug_session_id: debugSessionId })
    )
  }
  async setFolder(projectId: string, folder: string) {
    return WireFolderSchema.parse(
      await this.request('trace.v1.folder.set', { project_id: projectId, folder })
    )
  }
  async runs(projectId: string) {
    return WireFolderSchema.extend({ runs: z.array(WireRunSummarySchema) }).parse(
      await this.request('trace.v1.runs', { project_id: projectId })
    )
  }
  async run(projectId: string, runId: string, from?: number, limit?: number) {
    return WireRunSchema.parse(
      await this.request('trace.v1.run', {
        project_id: projectId,
        run_id: runId,
        ...(from ? { from } : {}),
        ...(limit ? { limit } : {}),
      })
    )
  }
  /** A whole run, page after page; the node stops each page under its record size. */
  async wholeRun(projectId: string, runId: string): Promise<WireRun> {
    const first = await this.run(projectId, runId)
    const steps = [...first.steps]
    let next = first.next
    while (next !== undefined) {
      const page = await this.run(projectId, runId, next)
      steps.push(...page.steps)
      next = page.next
    }
    return { ...first, steps, next: undefined }
  }
  async value(
    projectId: string,
    runId: string,
    step: string,
    name: string,
    view: TraceView,
    options: {
      path?: string
      from?: number
      against?: { step: string; name: string }
      cap?: TraceCap
    } = {}
  ) {
    return WireValueResultSchema.parse(
      await this.request('trace.v1.value', {
        project_id: projectId,
        run_id: runId,
        step,
        name,
        view,
        ...options,
      })
    )
  }
  async find(
    projectId: string,
    runId: string,
    needle: { value?: string | number | boolean; key?: string; loose?: boolean }
  ) {
    return z
      .object({ hits: z.array(WireHitSchema) })
      .parse(
        await this.request('trace.v1.find', { project_id: projectId, run_id: runId, ...needle })
      ).hits
  }
  async follow(projectId: string, runId: string, value: string | number | boolean) {
    return WireTrailSchema.parse(
      await this.request('trace.v1.follow', { project_id: projectId, run_id: runId, value })
    )
  }
  async mark(
    projectId: string,
    runId: string,
    mark: { step: string; name?: string; path?: string; comment: string; tags?: string[] }
  ) {
    await this.request('trace.v1.mark', { project_id: projectId, run_id: runId, ...mark })
  }
  async rename(projectId: string, runId: string, name: string) {
    await this.request('trace.v1.rename', { project_id: projectId, run_id: runId, name })
  }
  async remove(projectId: string, runId: string) {
    await this.request('trace.v1.delete', { project_id: projectId, run_id: runId })
  }
}

const TraceDescription = z.object({
  capabilities: z.object({
    capabilities: z.object({
      trace_v1: z.object({ status: z.string() }).optional(),
    }),
  }),
})
/** Recording is offered where the node says it records runs. */
export function nodeTraceSupported(description: unknown): boolean {
  const r = TraceDescription.safeParse(description)
  return r.success && r.data.capabilities.capabilities.trace_v1?.status === 'supported'
}
