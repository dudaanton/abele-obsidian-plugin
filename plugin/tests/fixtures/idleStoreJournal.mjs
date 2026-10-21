/**
 * Protocol-valid synthetic history shared by the schema check and the browser measurement.
 * Kept self-contained so its source can run inside the app without sending a large payload.
 * @param {number} [length]
 */
export function idleStoreJournal(length = 30000) {
  return Array.from({ length }, (_, i) => ({
    kind: 'event',
    node_id: 'sample-node',
    stream_id: 'sample-session',
    seq: i + 1,
    type: 'input.accepted',
    actor: { kind: 'node' },
    at: '2026-01-01T00:00:00.000Z',
    data: { input_id: `sample-input-${i}`, text: 'sample output '.repeat(50) + i },
  }))
}
