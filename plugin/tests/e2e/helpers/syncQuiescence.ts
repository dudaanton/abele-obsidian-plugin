/** A completed exchange may enqueue a dependent directory commit on the next pass.
 * Every peer must consume a head which remains unchanged throughout a full round. */
export async function settleSyncPeers(
  head: () => Promise<number>,
  peers: readonly (() => Promise<unknown>)[],
  limit = 8
): Promise<void> {
  let before = await head()
  for (let round = 0; round < limit; round++) {
    for (const sync of peers) await sync()
    const after = await head()
    if (after === before) return
    before = after
  }
  throw new Error('Sync fixture did not reach a stable server head after ' + limit + ' rounds')
}
