/** Summarize checkpoint wire events without copying request headers or bodies. */
export function summarizeWire(wire, limit = 12) {
  const groups = new Map()
  if (wire[0]?.event) {
    for (const event of wire) {
      const device = String(event.device ?? 'unknown')
      if (!groups.has(device)) groups.set(device, [])
      groups.get(device).push(event)
    }
  } else {
    wire.forEach((row, index) => groups.set(String(index), row.events ?? row))
  }
  return [...groups].map(([device, events]) => {
    const starts = new Map(
      events.filter((row) => row.event === 'start').map((row) => [row.id, row])
    )
    const finished = events.filter((row) => row.event === 'finish')
    const statuses = {}
    for (const row of finished) statuses[row.status] = (statuses[row.status] ?? 0) + 1
    return {
      device,
      statuses,
      tail: finished.slice(-Math.max(1, Math.floor(limit))).map((row) => {
        const start = starts.get(row.id)
        return {
          at: row.at,
          route: start?.route,
          method: start?.method,
          status: row.status,
          bytes: row.bytes,
          operations: start?.operations?.length ?? 0,
        }
      }),
    }
  })
}
