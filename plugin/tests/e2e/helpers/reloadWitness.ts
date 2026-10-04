export interface ReloadWitness {
  owner: string
  generation: number
  requestId: string | null
  mobile: boolean
  apiReady: boolean
  layoutReady: boolean
}

export interface ReloadPorts {
  request(): string
  read(): ReloadWitness
  pause(ms: number): Promise<void>
  now(): number
}

/** Observe a possibly executed request; never replay it after a missing acknowledgment. */
export async function confirmReload(
  before: ReloadWitness,
  requestId: string,
  mobile: boolean,
  ports: ReloadPorts,
  timeoutMs: number
): Promise<{ acknowledged: boolean; witness: ReloadWitness; requestError?: string }> {
  let acknowledged = false
  let requestError: string | undefined
  try {
    acknowledged = ports.request() === requestId
    if (!acknowledged) requestError = 'unexpected request acknowledgment'
  } catch (error) {
    requestError = error instanceof Error ? error.message : String(error)
  }
  const deadline = ports.now() + timeoutMs
  let last: ReloadWitness | undefined
  let readError: string | undefined
  do {
    try {
      last = ports.read()
      if (
        last.owner === before.owner &&
        last.generation !== before.generation &&
        last.requestId === requestId &&
        last.mobile === mobile &&
        last.apiReady &&
        last.layoutReady
      )
        return { acknowledged, witness: last, requestError }
    } catch (error) {
      readError = error instanceof Error ? error.message : String(error)
    }
    if (ports.now() >= deadline) break
    await ports.pause(Math.min(250, deadline - ports.now()))
  } while (ports.now() <= deadline)
  throw new Error(
    `Reload unconfirmed: ${JSON.stringify({ acknowledged, requestId, requestError, before, last, readError })}`
  )
}
