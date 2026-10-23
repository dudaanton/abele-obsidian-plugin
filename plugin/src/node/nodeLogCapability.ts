import { nodeAdvertisesMethod } from './advertisedMethods'

interface LogConnection {
  client: unknown
  readonly authorizationGeneration: number
}
const remembered = new WeakMap<LogConnection, { authority: number; available: boolean }>()

/** A disconnect drops the SDK channel, not the last admitted welcome's capabilities. */
export function nodeLogAvailable(connection?: LogConnection): boolean {
  if (!connection) return false
  const authority = connection.authorizationGeneration
  if (
    connection.client &&
    typeof connection.client === 'object' &&
    'channel' in connection.client &&
    connection.client.channel
  ) {
    remembered.set(connection, {
      authority,
      available: nodeAdvertisesMethod(connection.client, 'node.log.v1.tail'),
    })
  }
  const previous = remembered.get(connection)
  return previous !== undefined && previous.authority === authority && previous.available
}
