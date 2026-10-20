import { z } from 'zod'

const Description = z.object({
  capabilities: z.object({
    capabilities: z.object({
      debugger_v1: z
        .object({
          status: z.string(),
          breakpoint_hit_condition: z.boolean().optional(),
          breakpoint_enabled: z.boolean().optional(),
        })
        .optional(),
    }),
  }),
})

export function breakpointCapabilities(description: unknown) {
  const parsed = Description.safeParse(description)
  const capability = parsed.success ? parsed.data.capabilities.capabilities.debugger_v1 : undefined
  return {
    breakpoint_hit_condition:
      capability?.status === 'supported' && capability.breakpoint_hit_condition === true,
    breakpoint_enabled:
      capability?.status === 'supported' && capability.breakpoint_enabled === true,
  }
}
