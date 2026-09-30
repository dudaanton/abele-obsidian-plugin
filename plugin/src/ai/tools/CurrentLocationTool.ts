import type { AgentTool } from '../client'
import { getDeviceLocation } from '@/services/DeviceLocation'

export function createCurrentLocationTool(): AgentTool {
  return {
    name: 'current_location',
    label: 'Current location',
    description:
      'Request the current location of the device running this chat, not another synced device. ' +
      'Location is personal data: request it only when the answer depends on where the person is. ' +
      'Returns latitude, longitude, accuracy in metres, timestamp in Unix milliseconds, and the answering device platform. ' +
      'Requires device location permission and may fail on desktop platforms without a location provider. ' +
      'Script ctx.agent() runs permit Ask and Auto like other enabled feature tools, without confirmation. ' +
      'Delegated chat runs cannot confirm Ask-mode requests; only Auto permits location there. ' +
      'No address lookup is sent automatically; use geocode separately only if a place name is needed.',
    parameters: { type: 'object', properties: {} },
    execute: async (_id, _params, signal) => ({
      content: [{ type: 'text', text: JSON.stringify(await getDeviceLocation(signal)) }],
    }),
  }
}
