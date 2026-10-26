type Receipt = { session_id: string; run_id: string; state: string }
type WaitOptions<T> = {
  read(receipt: T): Promise<T>
  cancel(receipt: T): Promise<unknown>
  guard(): void
  schedule(callback: () => void, milliseconds: number): () => void
  signal?: AbortSignal
}

/** Wait on one admitted run; a transport interruption must never submit another command. */
export async function waitNodeCommand<T extends Receipt>(initial: T, options: WaitOptions<T>) {
  let current = initial
  let deadline = Infinity
  const expired = () => ({
    ...current,
    wait_expired: true,
    instruction:
      'Command has not finished. Do not treat this as success or start a replacement. Call node_command_status with this session_id and run_id to read its final exit code and output.',
  })
  let timer: (() => void) | undefined
  let pause: (() => void) | undefined
  let cancelTimer: (() => void) | undefined
  let abort: (() => void) | undefined
  let expire!: () => void
  const interrupted = new Promise<never>((_, reject) => {
    expire = () => reject(new Error('command_wait_expired'))
    abort = () => reject(new Error('Command wait cancelled'))
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
  })
  // A stop can arrive before the first status read (or with an already terminal receipt).
  void interrupted.catch(() => {})
  try {
    while (['pending_approval', 'running'].includes(current.state)) {
      options.guard()
      // The execution budget starts after approval, never while the owner is deciding.
      if (current.state === 'running' && deadline === Infinity) {
        deadline = Date.now() + 10 * 60_000
        timer = options.schedule(expire, deadline - Date.now())
      }
      if (Date.now() >= deadline) return expired()
      try {
        current = await Promise.race([options.read(current), interrupted])
      } catch (error) {
        if (options.signal?.aborted) throw error
        if (
          !/disconnected|not.connected|connection.*(?:closed|failed)|timeout|timed.out/i.test(
            String(error)
          )
        )
          throw error
        console.debug('[Abele node] Command wait reconnecting', initial.run_id, error)
      }
      if (!['pending_approval', 'running'].includes(current.state)) break
      await Promise.race([
        new Promise<void>((resolve) => {
          pause = options.schedule(resolve, 1000)
        }),
        interrupted,
      ])
    }
    options.guard()
    return current
  } catch (error) {
    if (options.signal?.aborted) {
      await Promise.race([
        options
          .cancel(initial)
          .catch((failure) =>
            console.debug(
              '[Abele node] Command cancellation awaits reconnect',
              initial.run_id,
              failure
            )
          ),
        new Promise<void>((resolve) => {
          cancelTimer = options.schedule(resolve, 5000)
        }),
      ])
      throw error
    }
    if (Date.now() >= deadline) return expired()
    throw error
  } finally {
    timer?.()
    pause?.()
    cancelTimer?.()
    if (abort) options.signal?.removeEventListener('abort', abort)
  }
}
