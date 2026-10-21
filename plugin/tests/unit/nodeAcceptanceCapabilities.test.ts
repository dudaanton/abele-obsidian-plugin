import { expect, it } from 'vitest'
import {
  debuggerAcceptanceCapabilities,
  deviceDisconnectSupported,
} from '@/node/acceptanceCapabilities'

it('enables additive contracts only when the node advertises support', () => {
  const description = {
    capabilities: {
      capabilities: {
        debugger_v1: {
          status: 'supported',
          frame_source_paths: true,
          launch_stop_on_entry: true,
          exit_code: true,
          launch_preflight: true,
        },
        trace_v1: { status: 'supported', bound_record_points: true },
        device_disconnect: { status: 'supported' },
      },
    },
  }
  expect(debuggerAcceptanceCapabilities(description)).toMatchObject({
    frame_source_paths: true,
    launch_stop_on_entry: true,
    exit_code: true,
    launch_preflight: true,
    bound_record_points: true,
  })
  expect(deviceDisconnectSupported(description)).toBe(true)
  expect(debuggerAcceptanceCapabilities({})).toMatchObject({
    frame_source_paths: false,
    launch_stop_on_entry: false,
    exit_code: false,
    launch_preflight: false,
    bound_record_points: false,
  })
  expect(deviceDisconnectSupported({})).toBe(false)
  description.capabilities.capabilities.debugger_v1.status = 'unsupported'
  expect(debuggerAcceptanceCapabilities(description).exit_code).toBe(false)
})
