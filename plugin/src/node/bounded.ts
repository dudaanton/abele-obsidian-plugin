/**
 * How many files of a commit page are read at once. The node serves at most four repository
 * reads together and refuses the next, so the page leaves room for the rest of the panel.
 */
export const COMMIT_FILE_READS = 2

/**
 * Runs `work` over the items in their order, at most `limit` at once. Once `stop()` says so no
 * further item starts; those already started finish.
 */
export async function eachBounded<T>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<void>,
  stop = () => false
): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length && !stop()) {
        const index = next++
        await work(items[index], index)
      }
    })
  )
}
