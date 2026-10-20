import { z } from 'zod'

const Flags = z.object({
  frame_source_paths: z.boolean().optional(),
  stop_exception_text: z.boolean().optional(),
  launch_stop_on_entry: z.boolean().optional(),
  exit_code: z.boolean().optional(),
  attach_breakpoint_restore: z.boolean().optional(),
  status: z.string(),
})
const Description = z.object({
  capabilities: z.object({
    capabilities: z.object({
      debugger_v1: Flags.optional(),
      device_disconnect: z.object({ status: z.string() }).optional(),
    }),
  }),
})

/** Additive wire contracts, kept local until the released SDK exposes them. */
export function debuggerAcceptanceCapabilities(description: unknown) {
  const parsed = Description.safeParse(description)
  const flags = parsed.success ? parsed.data.capabilities.capabilities.debugger_v1 : undefined
  const supported = flags?.status === 'supported'
  return {
    frame_source_paths: supported && flags.frame_source_paths === true,
    stop_exception_text: supported && flags.stop_exception_text === true,
    launch_stop_on_entry: supported && flags.launch_stop_on_entry === true,
    exit_code: supported && flags.exit_code === true,
    attach_breakpoint_restore: supported && flags.attach_breakpoint_restore === true,
  }
}
export function deviceDisconnectSupported(description: unknown): boolean {
  const parsed = Description.safeParse(description)
  return (
    parsed.success &&
    parsed.data.capabilities.capabilities.device_disconnect?.status === 'supported'
  )
}
