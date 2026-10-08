import { z } from 'zod'

const Capability = z.union([
  z.object({ status: z.literal('supported'), evidence: z.string() }),
  z.object({ status: z.enum(['unsupported', 'unverified']), reason: z.string() }),
])
const Provider = z.object({
  provider: z.enum(['claude', 'pi', 'fake']),
  available: z.boolean().optional(),
  diagnostic: z.string().optional(),
  configuration: z
    .object({ model: z.string().optional(), profile: z.string().optional() })
    .optional(),
  capabilities: z.record(z.string(), Capability).default({}),
})
export type NodeProvider = z.infer<typeof Provider>
export type NodeProviderName = NodeProvider['provider']
export const providerLabel = (name: string): string =>
  name === 'pi' ? 'pi' : name === 'claude' ? 'Claude Code' : 'Fake (non-executing)'
export const providerAvailable = (p: NodeProvider): boolean =>
  p.available === true || (p.provider === 'fake' && p.available !== false)
export function nodeProviders(description: unknown): NodeProvider[] {
  const raw =
    description && typeof description === 'object'
      ? (description as { providers?: unknown }).providers
      : undefined
  if (!Array.isArray(raw)) return []
  return raw.flatMap((value) => {
    const result = Provider.safeParse(value)
    return result.success ? [result.data] : []
  })
}
export function capabilityReason(provider: NodeProvider | undefined, feature: string): string {
  const capability = provider?.capabilities[feature]
  return capability?.status === 'supported'
    ? ''
    : (capability?.reason ?? 'Not reported by this node')
}
