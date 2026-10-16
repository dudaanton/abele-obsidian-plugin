import type { NodeClient } from '@abele/node-client'
import { ChannelError, type JournalEvent } from '@abele/channel-protocol'
import { NodeEventSchema } from '@abele/node-protocol'
import type { NodeClientState } from './NodeClientStore'

/**
 * How many of a session's latest events a device keeps and shows at once. A long session holds
 * tens of thousands; the chat opens on these and reads earlier ones from the node page by page.
 */
export const SESSION_WINDOW = 400
/** The most `stream.read` gives at once. */
export const PAGE = 256

/** A windowed stream keeps its latest events only; the rest stay on the node. */
export function trimWindows(state: NodeClientState): void {
  for (const [stream, keep] of Object.entries(state.windows ?? {})) {
    const events = state.events[stream]
    if (events && events.length > keep) state.events[stream] = events.slice(-keep)
  }
}

/**
 * Before subscribing: asks the node where the session's journal ends and, when this device is
 * further behind than a window (a new device is at 0), moves its cursor to a window before the
 * end and forgets what it kept, so the node streams only the window. A device close behind
 * reads only what it missed. Null from a node that cannot say: it is read whole, as before.
 */
export async function openWindow(
  client: NodeClient,
  stream: string,
  window = SESSION_WINDOW
): Promise<{ head: number; from: number; jumped: boolean } | null> {
  let head: number
  try {
    const answer = (await client.request('stream.head', { stream_id: stream })) as {
      head_seq?: unknown
    }
    if (!Number.isSafeInteger(answer?.head_seq)) return null
    head = answer.head_seq as number
  } catch (error) {
    // An older node, or the connection going: the session is read as before, and a lost
    // connection is said by the subscription that follows.
    console.debug('[Abele node] stream.head unavailable', error)
    return null
  }
  return windowAt(client, stream, head, window)
}

/**
 * Keeps `stream` as a window of `window` events before `head`: a device further behind moves its
 * cursor there and forgets what it kept. Also used with the head a subscription answers with,
 * on a node that has no `stream.head`; then `jumped` says the subscription must start again.
 */
export async function windowAt(
  client: NodeClient,
  stream: string,
  head: number,
  window = SESSION_WINDOW
): Promise<{ head: number; from: number; jumped: boolean }> {
  const { from, jumped } = await client.store.transaction((raw) => {
    const state = raw as NodeClientState
    ;(state.windows ??= {})[stream] = window
    const cursor = state.cursors[stream] ?? 0
    const jumped = head - cursor > window
    if (jumped) {
      state.cursors[stream] = head - window
      state.events[stream] = []
    }
    const kept = state.events[stream] ?? []
    return { from: kept[0]?.seq ?? state.cursors[stream] + 1, jumped }
  })
  console.debug('[Abele node] session window', { stream, head, from, jumped })
  return { head, from, jumped }
}

/** The page of events just before `before`, oldest first; none before the journal's start. */
export async function readOlder(
  client: NodeClient,
  stream: string,
  before: number
): Promise<JournalEvent[]> {
  if (before <= 1) return []
  const after = Math.max(0, before - 1 - PAGE)
  const raw = await client.request('stream.read', {
    stream_id: stream,
    after_seq: after,
    limit: before - 1 - after,
  })
  if (!Array.isArray(raw)) throw new ChannelError('invalid_result')
  return raw.map((event) => NodeEventSchema.parse(event)).filter((e) => e.seq < before)
}
