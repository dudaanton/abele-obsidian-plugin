/** Serialized into browser probes: observe focus/viewport reflow until the whole sample is quiet. */
export async function settledGeometry<T>(
  read: () => T,
  pause: () => Promise<void>,
  now: () => number,
  timeoutMs = 10000,
  quietMs = 400
): Promise<T> {
  const deadline = now() + timeoutMs
  let previous = ''
  let since = now()
  let sample = read()
  do {
    sample = read()
    const next = JSON.stringify(sample)
    if (next !== previous) {
      previous = next
      since = now()
    } else if (now() - since >= quietMs) return sample
    if (now() >= deadline) break
    await pause()
  } while (now() <= deadline)
  throw new Error('Geometry did not settle: ' + JSON.stringify(sample))
}
