/** Only a fixture-owned window may be passed to the force-close port. */
export async function closeOwnedWindows(
  close: () => void,
  force: () => void,
  wait: () => Promise<void>
): Promise<void> {
  const failures: unknown[] = []
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      close()
    } catch (error) {
      failures.push(error)
    }
    try {
      await wait()
      return
    } catch (error) {
      failures.push(error)
    }
  }
  try {
    force()
    await wait()
  } catch (error) {
    throw new AggregateError(
      [...failures, error],
      'Owned temporary window could not be closed; vault registration and files kept'
    )
  }
}
