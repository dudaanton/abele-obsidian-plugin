export function evaluationExpression(body, nonce) {
  return `(async()=>{try{const value=await(async()=>{${body}})();return JSON.stringify({__abeleReply:${JSON.stringify(nonce)},hasValue:value!==undefined,value})}catch(error){return JSON.stringify({__abeleReply:${JSON.stringify(nonce)},error:{kind:String(error?.name??'Error'),message:String(error?.message??error),stack:typeof error?.stack==='string'?error.stack:undefined}})}})()`
}

export function observationError(error) {
  return (
    error.scaleObservationError ?? {
      kind: error.name ?? 'Error',
      message: error.message ?? String(error),
      stack: error.stack,
    }
  )
}

export function decodeEvaluationReply(reply, nonce) {
  if (reply?.__abeleReply === nonce && reply.error) {
    const error = new Error(reply.error.message)
    error.scaleObservationError = reply.error
    throw error
  }
  if (reply?.__abeleReply !== nonce || !reply.hasValue) {
    const error = new Error('Vault CLI returned no JSON result')
    error.scaleObservationError = { kind: 'InvalidReply', message: error.message }
    throw error
  }
  return reply.value
}

export function decodeEvaluationOutput(stdout, nonce) {
  for (const match of stdout.matchAll(/(?:^|\n)=> /g)) {
    let reply
    try {
      reply = JSON.parse(stdout.slice(match.index + match[0].length).trim())
    } catch {
      continue
    }
    if (reply?.__abeleReply === nonce) return decodeEvaluationReply(reply, nonce)
  }
  return decodeEvaluationReply(null, nonce)
}

// Only wrap a read observation. A successful snapshot containing a product error is
// returned unchanged so the caller's strict health check still fails immediately.
export async function observeStartup(
  observe,
  {
    timeoutMs = 30000,
    maxAttempts = 5,
    now = Date.now,
    delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    record = async () => {},
  } = {}
) {
  const startedAt = now()
  for (let attempt = 1; ; attempt++) {
    try {
      return await observe(Math.max(1, timeoutMs - (now() - startedAt)))
    } catch (error) {
      if (!error.scaleObservationError && !error.scaleCliFailure) throw error
      const elapsedMs = now() - startedAt
      const retrying = attempt < maxAttempts && elapsedMs + 250 < timeoutMs
      await record({
        attempt,
        at: now(),
        elapsedMs,
        retrying,
        error: observationError(error),
        cli: error.scaleCliFailure,
      })
      if (!retrying) throw error
      await delay(250)
    }
  }
}
