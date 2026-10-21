import { z } from 'zod'
import { t } from '@/i18n'
import type { NodeClient } from '@abele/node-client'
import { nodeProviders } from './providers'

const Description = z.object({
  capabilities: z.object({
    'tool.permissions.v1': z.object({ status: z.literal('supported') }),
  }),
})
export const ToolPermissionsSchema = z.object({
  permission_mode: z.string(),
  per_action_approval: z.boolean(),
  status: z.enum(['supported', 'unsupported']),
  reason: z.string().optional(),
})
export type ToolPermissions = z.infer<typeof ToolPermissionsSchema>

/** Ordinary delegation captures the stricter of the developer and parent effective modes. */
export function delegatedPermissionMode(own?: string, parent?: string): string {
  const selected = own ?? parent ?? 'confirm-all'
  const rank: Record<string, number> = { 'confirm-all': 0, 'allow-edit': 1, 'allow-all': 2 }
  return parent && (rank[parent] ?? 0) < (rank[selected] ?? 0) ? parent : selected
}

/** Only owner settings can authorize bypass. Missing capability is never consent. */
export function ownerPermissionPatch(
  description: unknown,
  ownerMode?: string
): { permission_mode?: 'manual' | 'bypassPermissions' } {
  const envelope = description as { capabilities?: unknown } | null
  return Description.safeParse(description).success ||
    Description.safeParse(envelope?.capabilities).success
    ? { permission_mode: ownerMode === 'allow-all' ? 'bypassPermissions' : 'manual' }
    : {}
}
export function readToolPermissions(value: unknown): ToolPermissions | undefined {
  const result = z.object({ tool_permissions: ToolPermissionsSchema }).safeParse(value)
  return result.success ? result.data.tool_permissions : undefined
}

/** Legacy nodes cannot enforce this provider's owner choice. Never start it by inference. */
export function legacyProviderRefusal(
  description: unknown,
  provider: string,
  ownerMode?: string
): string | undefined {
  const approval = nodeProviders(description).find((p) => p.provider === provider)?.configuration
    ?.per_action_approval
  const cannotAsk = approval === false || (provider === 'codex' && approval !== true)
  if (!cannotAsk || ownerPermissionPatch(description, ownerMode).permission_mode) return undefined
  return ownerMode === 'allow-all'
    ? 'tool_permissions_unavailable'
    : 'interactive_approval_unsupported'
}

export async function configureOwnerPermissionMode(
  client: Pick<NodeClient, 'describe' | 'configureSession'>,
  session: string,
  ownerMode?: string,
  provider?: string
): Promise<void> {
  const description = await client.describe()
  const refusal = provider && legacyProviderRefusal(description, provider, ownerMode)
  if (refusal) throw new Error(refusal)
  const patch = ownerPermissionPatch(description, ownerMode)
  if (patch.permission_mode)
    await client.configureSession(session, {
      permission_mode: patch.permission_mode,
    })
}

export function permissionLabel(policy?: ToolPermissions): string {
  if (!policy) return t('streamB.permissionUnknown')
  switch (policy.permission_mode) {
    case 'manual':
      return t('streamB.permissionAsk')
    case 'bypassPermissions':
      return t('streamB.permissionBypass')
    case 'acceptEdits':
      return t('chat.acceptEdits')
    case 'auto':
      return t('chat.auto')
    case 'plan':
      return t('chat.plan')
    case 'dontAsk':
      return t('chat.dontAsk')
    default:
      return policy.permission_mode
  }
}
export function permissionRefusal(reason?: string | null): string {
  if (!reason) return ''
  if (reason.includes('interactive_approval_unsupported')) return t('streamB.permissionNeedsBypass')
  if (reason.includes('tool_permissions_unavailable')) return t('streamB.permissionUpdateNode')
  if (/bypass.*(disabled|unsupported|not_allowed|not_enabled)|allow.bypass/.test(reason))
    return t('streamB.permissionNodeOptIn')
  return ''
}
