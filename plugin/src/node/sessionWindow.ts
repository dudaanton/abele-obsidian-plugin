import { responseSchema } from '@abele/channel-protocol'
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
    head = await client.head(stream)
  } catch (error) {
    // A node before 0.4.18 has no stream.head, or the connection is going: the session is read
    // as before, and a lost connection is said by the subscription that follows.
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

/**
 * Reads what this device has not got of the session up to `head` in pages and keeps it in one
 * store transaction, instead of the node streaming it event by event (a durable transaction
 * each). The subscription that follows then starts at the head. Gives up quietly, leaving the
 * subscription to stream, when another reader moved the cursor meanwhile or a page is not
 * contiguous. Returns how many events it kept.
 */
export async function catchUp(client: NodeClient, stream: string, head: number): Promise<number> {
  const cursor = await client.cursor(stream)
  const fetched: JournalEvent[] = []
  while (cursor + fetched.length < head) {
    const after = cursor + fetched.length
    const raw = await client.request('stream.read', {
      stream_id: stream,
      after_seq: after,
      limit: Math.min(PAGE, head - after),
    })
    if (!Array.isArray(raw) || !raw.length) break
    const page = raw.map((event) => responseSchema(NodeEventSchema).parse(event))
    if (page.some((event, i) => event.seq !== after + 1 + i)) break
    fetched.push(...page)
  }
  if (!fetched.length) return 0
  return client.store.transaction((raw) => {
    const state = raw as NodeClientState
    if ((state.cursors[stream] ?? 0) !== cursor) return 0
    if (fetched.some((event) => event.node_id !== state.node_id || event.stream_id !== stream))
      throw new ChannelError('node_identity_mismatch')
    ;(state.events[stream] ??= []).push(...fetched)
    state.cursors[stream] = fetched[fetched.length - 1].seq
    return fetched.length
  })
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
  return raw
    .map((event) => responseSchema(NodeEventSchema).parse(event))
    .filter((e) => e.seq < before)
}
