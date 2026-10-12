export type PhoneRouteResult =
  | { ok: true }
  | {
      ok: false
      stage: 'upgrade' | 'authentication'
      cause: 'close' | 'timeout' | 'error' | 'constructor' | 'send' | 'invalid-message'
      code?: number
      clean?: boolean
    }

/** Serialized into the page: return only safe fields through the confidential job channel. */
export function phoneRouteProbe(address: string, key: string): Promise<PhoneRouteResult> {
  return new Promise((resolve) => {
    let socket: WebSocket | undefined
    let stage: 'upgrade' | 'authentication' = 'upgrade'
    let settled = false
    let errored = false
    const timer = setTimeout(
      () => finish({ ok: false, stage, cause: errored ? 'error' : 'timeout' }),
      5000
    )
    function finish(result: PhoneRouteResult): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (socket) {
        socket.onopen = socket.onerror = socket.onclose = socket.onmessage = null
        socket.close()
      }
      resolve(result)
    }
    try {
      socket = new WebSocket(address)
    } catch {
      finish({ ok: false, stage, cause: 'constructor' })
      return
    }
    socket.onopen = () => {
      stage = 'authentication'
      try {
        socket!.send(JSON.stringify({ token: key }))
      } catch {
        finish({ ok: false, stage, cause: 'send' })
      }
    }
    // Browsers hide upgrade HTTP status and errno. Wait for the following close code.
    socket.onerror = () => {
      errored = true
    }
    socket.onclose = (event) =>
      finish({ ok: false, stage, cause: 'close', code: event.code, clean: event.wasClean })
    socket.onmessage = (event) => {
      try {
        if (JSON.parse(event.data).type === 'changes') finish({ ok: true })
      } catch {
        finish({ ok: false, stage, cause: 'invalid-message' })
      }
    }
  })
}

/** Do not stringify even a purportedly safe page reply: validate every diagnostic field. */
export function phoneRouteDetail(result: PhoneRouteResult, port: number, reverse: string): string {
  const stage =
    result.ok === false && result.stage === 'authentication' ? 'authentication' : 'upgrade'
  const cause =
    result.ok === false &&
    ['close', 'timeout', 'error', 'constructor', 'send', 'invalid-message'].includes(result.cause)
      ? result.cause
      : 'unknown'
  const code =
    result.ok === false &&
    Number.isInteger(result.code) &&
    result.code! >= 0 &&
    result.code! <= 65535
      ? ` code=${result.code}`
      : ''
  const clean =
    result.ok === false && typeof result.clean === 'boolean' ? ` clean=${result.clean}` : ''
  return `port=${port} reverse=${reverse} stage=${stage} cause=${cause}${code}${clean}`
}
