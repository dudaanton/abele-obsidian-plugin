/** Cleanup still runs after a failed case, but cannot replace its diagnostic. */
export async function preserveCleanupError<T>(
  action: () => Promise<T>,
  cleanup: () => void | Promise<void>
): Promise<T> {
  let failed = false
  let failure: unknown
  let result!: T
  try {
    result = await action()
  } catch (error) {
    failed = true
    failure = error
  }
  try {
    await cleanup()
  } catch (error) {
    if (!failed) throw error
    console.error('Cleanup also failed:', error)
  }
  if (failed) throw failure
  return result
}
