/** A completed exchange may enqueue a dependent directory commit on the next pass.
 * Every peer must consume a head which remains unchanged throughout a full round. */
export async function settleSyncPeers(
  head: () => Promise<number>,
  peers: readonly (() => Promise<unknown>)[],
  limit = 8
): Promise<void> {
  const readHead = async () => {
    const value = await head()
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error('Sync fixture received an invalid server head: ' + String(value))
    return value
  }
  let before = await readHead()
  for (let round = 0; round < limit; round++) {
    for (const sync of peers) await sync()
    const after = await readHead()
    if (after === before) return
    before = after
  }
  throw new Error('Sync fixture did not reach a stable server head after ' + limit + ' rounds')
}
