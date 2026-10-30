import { responseSchema } from '@abele/channel-protocol'
import { z } from 'zod'
import { DebuggerGrantSchema } from '@abele/node-protocol'
import { t } from '@/i18n'
import type { MessageKey } from '@/i18n/types'

// Additive wire adapter until the browser SDK includes debugger.access.v1.
const Request = z.object({
  request_id: z.string().min(1),
  conversation_id: z.string().min(1),
  folder: z.string().nullable(),
  program: z.string(),
  access: z.string(),
  expires_at: z.iso.datetime(),
})
export type DebuggerAccessRequest = z.infer<typeof Request>
export type DebuggerGrant = ReturnType<typeof DebuggerGrantSchema.parse>
type Rpc = (method: string, params: Record<string, unknown>) => Promise<unknown>
type Authority = { installation_id: string; profile: string; device_key?: unknown }
export function mayDeleteGrant(grant: { owner_authority?: Authority }, owner?: Authority) {
  const issuer = grant.owner_authority
  return (
    !!owner &&
    !!issuer &&
    issuer.installation_id === owner.installation_id &&
    issuer.profile === owner.profile &&
    (owner.profile !== 'paired-wss-v1' ||
      JSON.stringify(issuer.device_key) === JSON.stringify(owner.device_key))
  )
}
export function debuggerAccessSupported(raw: unknown): boolean {
  const description = z
    .object({
      capabilities: z.object({ capabilities: z.record(z.string(), z.unknown()) }),
    })
    .safeParse(raw)
  if (!description.success) return false
  const status = z
    .object({ status: z.literal('supported') })
    .safeParse(description.data.capabilities.capabilities['debugger.access.v1'])
  return status.success
}
const ACTION_LABELS = {
  read: 'debuggerAccess.action.read',
  step: 'debuggerAccess.action.step',
  continue: 'debuggerAccess.action.continue',
  pause: 'debuggerAccess.action.pause',
  breakpoints: 'debuggerAccess.action.breakpoints',
  launch: 'debuggerAccess.action.launch',
  attach: 'debuggerAccess.action.attach',
  detach: 'debuggerAccess.action.detach',
  terminate: 'debuggerAccess.action.terminate',
  expressions: 'debuggerAccess.action.expressions',
  'evaluate/setVariable': 'debuggerAccess.action.evaluate',
} as const satisfies Record<string, MessageKey>
export function debuggerAccessLabel(action: string): string {
  return Object.hasOwn(ACTION_LABELS, action)
    ? t(ACTION_LABELS[action as keyof typeof ACTION_LABELS])
    : action
}

/** Owner-channel access workflow; never dispatches or replays an agent debugger operation. */
export class DebuggerAccess {
  supported = false
  requests: DebuggerAccessRequest[] = []
  grants: DebuggerGrant[] = []
  decisions: Record<string, 'allow' | 'deny'> = {}
  error = ''
  busy = false
  private description: unknown
  constructor(private readonly rpc: Rpc) {}
  async load(description: unknown) {
    this.description = description
    this.supported = debuggerAccessSupported(description)
    if (!this.supported) {
      this.requests = []
      return
    }
    const requests = z
      .array(Request)
      .max(128)
      .parse(await this.rpc('debugger.v1.access.requests', {}))
    this.error = ''
    this.requests = [
      ...this.requests.filter(
        (r) => this.decisions[r.request_id] && !requests.some((p) => p.request_id === r.request_id)
      ),
      ...requests,
    ]
  }
  async decide(request_id: string, decision: 'allow' | 'deny') {
    if (this.busy || !this.supported) return
    this.busy = true
    this.error = ''
    const request = this.requests.find((r) => r.request_id === request_id)
    try {
      const result = await this.rpc('debugger.v1.access.decide', { request_id, decision })
      if (decision === 'allow') responseSchema(DebuggerGrantSchema).parse(result)
      else z.object({ denied: z.literal(true) }).parse(result)
      this.decisions[request_id] = decision
      if (request && !this.requests.some((r) => r.request_id === request_id))
        this.requests.push(request)
      console.debug('[debugger] Access request decided', decision)
    } catch (error) {
      const code =
        (error as { code?: string }).code ?? (error instanceof Error ? error.message : '')
      if (code === 'stale_state') {
        await this.load(this.description)
        this.error = t('debuggerAccess.stale')
      } else this.error = error instanceof Error ? error.message : t('debuggerAccess.unavailable')
    } finally {
      this.busy = false
    }
  }
  async loadGrants(description: unknown) {
    this.description = description
    this.supported = debuggerAccessSupported(description)
    if (!this.supported) {
      this.grants = []
      return
    }
    const grants: DebuggerGrant[] = []
    for (let offset = 0; ; offset += 16) {
      const page = z
        .array(z.unknown().transform((raw) => responseSchema(DebuggerGrantSchema).parse(raw)))
        .max(16)
        .parse(await this.rpc('debugger.v1.grant.list', { offset, limit: 16 }))
      grants.push(...page)
      if (page.length < 16) break
    }
    this.grants = grants
  }
  async revoke(grant_id: string) {
    await this.rpc('debugger.v1.grant.revoke', { grant_id })
    await this.loadGrants(this.description)
  }
  async remove(grant_id: string) {
    await this.rpc('debugger.v1.grant.delete', { grant_id })
    await this.loadGrants(this.description)
  }
  /** Only rows from the node's authenticated, issuer-filtered list receive management actions. */
  canManage(grant: DebuggerGrant) {
    return this.grants.some(
      (owned) => owned.grant_id === grant.grant_id && mayDeleteGrant(grant, owned.owner_authority)
    )
  }
}
