/**
 * The events of a Server-Sent Events body, read after the stream has closed.
 *
 * `requestUrl` hands back a response only once it is complete, so an MCP answer sent as a stream
 * arrives here as one string: whatever notifications the server sent first, then the response.
 * Only `data` matters; comments (lines starting with a colon) and `id`/`event`/`retry` are
 * skipped, and an event's several `data` lines are joined with newlines, as the format says.
 */
export function parseSseData(body: string): string[] {
  const events: string[] = []
  let data: string[] = []

  const flush = () => {
    if (data.length) events.push(data.join('\n'))
    data = []
  }

  for (const line of body.split(/\r\n|\r|\n/)) {
    if (line === '') {
      flush()
      continue
    }
    if (line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') data.push(value)
  }
  flush()

  return events
}
