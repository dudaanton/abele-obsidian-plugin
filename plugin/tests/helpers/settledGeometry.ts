/** Serialized into browser probes: observe focus/viewport reflow until the whole sample is quiet. */
export async function settledGeometry<T>(
  read: () => T,
  pause: () => Promise<void>,
  now: () => number,
  timeoutMs = 10000,
  quietMs = 400,
  ready?: (sample: T) => boolean
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
    } else if (now() - since >= quietMs && (!ready || ready(sample))) return sample
    if (now() >= deadline) break
    await pause()
  } while (now() <= deadline)
  throw new Error('Geometry did not settle or satisfy its prerequisite: ' + JSON.stringify(sample))
}
