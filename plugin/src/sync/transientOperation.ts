/** Explicit operations retain their result instead of relying on a later background exchange. */
export async function retryTransientOperation<T>(
  work: () => Promise<T>,
  assertCurrent: () => void
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    assertCurrent()
    try {
      const result = await work()
      assertCurrent()
      if ((result as { status?: string } | null)?.status !== 'offline' || attempt === 2)
        return result
    } catch (error) {
      if ((error as { code?: string } | null)?.code !== 'offline' || attempt === 2) throw error
    }
    // Match the engine's initial transport backoff; a persistent failure remains explicit.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 2000 * 2 ** attempt))
  }
}
