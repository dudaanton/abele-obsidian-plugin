export async function capturePausedBoundary({
  observe,
  capture,
  delay,
  now = Date.now,
  timeoutMs = 30000,
  quietMs = 100,
}) {
  const deadline = now() + timeoutMs
  let stable, stableAt
  while (now() <= deadline) {
    const state = await observe()
    const writes = state.writes
    const ready =
      state.paused === true &&
      writes?.complete === true &&
      writes.active === 0 &&
      typeof writes.generation === 'string' &&
      Number.isSafeInteger(writes.revision)
    const key = ready ? `${writes.generation}:${writes.revision}` : undefined
    if (!ready || key !== stable) {
      stable = key
      stableAt = now()
    }
    if (ready && now() - stableAt >= quietMs) {
      const receipt = await capture()
      const after = await observe()
      if (
        receipt.complete === true &&
        after.paused === true &&
        after.writes?.complete === true &&
        after.writes.active === 0 &&
        after.writes.generation === writes.generation &&
        after.writes.revision === writes.revision
      ) {
        receipt.quiescence = {
          observedAt: now(),
          generation: writes.generation,
          revision: writes.revision,
          active: 0,
          paused: true,
        }
        return receipt
      }
      stable = undefined
    }
    await delay(25)
  }
  throw new Error('Pause boundary did not reach a quiescent snapshot')
}
