export function evaluationExpression(body, nonce) {
  return `(async()=>{try{const value=await(async()=>{${body}})();return JSON.stringify({__abeleReply:${JSON.stringify(nonce)},hasValue:value!==undefined,value})}catch(error){return JSON.stringify({__abeleReply:${JSON.stringify(nonce)},error:{kind:String(error?.name??'Error'),message:String(error?.message??error)}})}})()`
}

const kinds = new Set([
  'Error',
  'TypeError',
  'ReferenceError',
  'SyntaxError',
  'RangeError',
  'EvalError',
  'URIError',
  'AggregateError',
  'DOMException',
  'TimeoutError',
  'AbortError',
  'InvalidReply',
])
const safeKind = (value) => (kinds.has(value) ? value : 'Error')

export function cliObservationError(error) {
  const code = error.exitCode ?? error.code
  const exitCode = Number.isInteger(code)
    ? code
    : [
          'ENOENT',
          'EACCES',
          'ETIMEDOUT',
          'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
          'ECONNRESET',
          'ENOBUFS',
        ].includes(code)
      ? code
      : undefined
  const signal = ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGABRT', 'SIGHUP', 'SIGSEGV'].includes(
    error.signal
  )
    ? error.signal
    : undefined
  return {
    kind: safeKind(error.kind ?? error.name),
    category: 'cli-execution-failure',
    exitCode,
    signal,
    timedOut:
      error.timedOut === true || code === 124 || code === 'ETIMEDOUT' || error.killed === true,
  }
}

function redactMessage(value, roots) {
  roots = roots.filter((root) => typeof root === 'string' && root.length > 1)
  return String(value ?? '')
    .replace(/\b(?:https?|file):\/\/[^\s"'<>]+/gi, '[redacted-url]')
    .replace(/\b(Bearer|Basic)\s+[^\s"',;]+/gi, '$1 [redacted]')
    .replace(
      /\b((?:access[-_]?|api[-_]?|private[-_]?)?(?:token|key|secret)|password|authorization)\b["']?\s*(?:[:=]\s*|\s+)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1=[redacted]'
    )
    .replace(/\b(?:sk-[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_.-]+|[A-Za-z0-9_-]{32,})\b/g, '[redacted]')
    .replace(/(?:[A-Za-z]:[\\/]|\/|\\\\)[^\s"'<>),;\]`]+/g, (path) =>
      roots.some(
        (root) =>
          path === root ||
          path.startsWith(root.replace(/[\\/]$/, '') + '/') ||
          path.startsWith(root.replace(/[\\/]$/, '') + '\\')
      ) && !path.split(/[\\/]/).includes('..')
        ? path
        : '[redacted-path]'
    )
    .slice(0, 512)
}

export function observationError(error, roots = []) {
  const source = error.scaleObservationError
  if (source?.category === 'cli-execution-failure') return cliObservationError(source)
  if (error.scaleCliFailure) return cliObservationError(error.scaleCliFailure)
  if (!source) return { kind: safeKind(error.name), category: 'unclassified-observation-failure' }
  return {
    kind: safeKind(source.kind),
    category: 'renderer-evaluation-failure',
    message: redactMessage(source.message, roots),
  }
}

export function decodeEvaluationReply(reply, nonce, roots = []) {
  if (reply?.__abeleReply === nonce && reply.error) {
    const safe = observationError({ scaleObservationError: reply.error }, roots)
    const error = new Error(safe.message)
    error.scaleObservationError = safe
    throw error
  }
  if (reply?.__abeleReply !== nonce || !reply.hasValue) {
    const error = new Error('Vault CLI returned no JSON result')
    error.scaleObservationError = observationError({
      scaleObservationError: { kind: 'InvalidReply', message: error.message },
    })
    throw error
  }
  return reply.value
}

export function decodeEvaluationOutput(stdout, nonce, roots = []) {
  for (const match of stdout.matchAll(/(?:^|\n)=> /g)) {
    let reply
    try {
      reply = JSON.parse(stdout.slice(match.index + match[0].length).trim())
    } catch {
      continue
    }
    if (reply?.__abeleReply === nonce) return decodeEvaluationReply(reply, nonce, roots)
  }
  return decodeEvaluationReply(null, nonce, roots)
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
    roots = [],
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
        error: observationError(error, roots),
        cli: error.scaleCliFailure ? cliObservationError(error.scaleCliFailure) : undefined,
      })
      if (!retrying) throw error
      await delay(250)
    }
  }
}
