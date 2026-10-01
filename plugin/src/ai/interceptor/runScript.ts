/**
 * Running an interceptor script on a message, and reading what it decided.
 *
 * Every way this can go wrong ends in `failed` with a reason a person can read — the caller
 * then sends the message as written and shows the reason. `stopped` is the person pressing
 * stop, which is not a failure: the caller keeps the message back for them to decide.
 */
import { ScriptService } from '@/scripting/ScriptService'
import { INTERCEPTOR_DEFAULT_SECONDS } from '@/scripting/ScriptParser'
import type { ParsedScript } from '@/scripting/types'
import { readInterceptResult, type InterceptResult } from './result'
import { toolPolicy, type ToolPolicy } from './policy'
import type { InterceptInput } from './context'

export type InterceptOutcome =
  | {
      kind: 'send'
      text: string
      attachments: string[]
      rewritten: boolean
      /** Explicit text/attachments, even unchanged: reply-only must explain discarded intent. */
      rewriteRequested?: boolean
      policy?: ToolPolicy
    }
  | Exclude<InterceptResult, { kind: 'send' } | { kind: 'invalid' }>
  | { kind: 'failed'; reason: string }
  | { kind: 'stopped' }

/** The scripts that can act as an interceptor, for the pickers. Reactive: it reads the index's list. */
export function interceptorScripts(): ParsedScript[] {
  return ScriptService.getInstance()
    .scriptList.value.filter((s) => s.meta.interceptor && s.meta.enabled !== false)
    .sort((a, b) => a.meta.name.localeCompare(b.meta.name))
}

function find(name: string): ParsedScript | string {
  const named = ScriptService.getInstance()
    .getAll()
    .filter((s) => s.meta.name === name)
  const usable = named.filter((s) => s.meta.interceptor)
  if (usable.length > 1) {
    return `more than one interceptor script is named "${name}" (${usable.map((s) => s.path).join(', ')}); rename one`
  }
  const [script] = usable
  if (script && script.meta.enabled === false) return `the script "${name}" is switched off`
  if (script) return script
  if (named.length) return `the script "${name}" has no @interceptor line`
  return `there is no script named "${name}"`
}

export async function runInterceptorScript(
  name: string,
  input: InterceptInput,
  signal: AbortSignal
): Promise<InterceptOutcome> {
  const service = ScriptService.getInstance()
  const controller = new AbortController()
  const runSignal = AbortSignal.any([signal, controller.signal])
  if (runSignal.aborted) return { kind: 'stopped' }

  let seconds = INTERCEPTOR_DEFAULT_SECONDS
  let timedOut = false
  let timer = 0
  const started = Date.now()
  const arm = () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(
      () => {
        timedOut = true
        controller.abort()
      },
      Math.max(0, seconds * 1000 - (Date.now() - started))
    )
  }
  // The clock runs from the send: waiting for the index counts too.
  arm()

  const expired = new Promise<'expired'>((resolve) => {
    runSignal.addEventListener('abort', () => resolve('expired'), { once: true })
  })

  try {
    // Right after start-up the index may not have been read yet; a script that is there would
    // look missing, and the message would go out unchecked for no reason.
    if ((await Promise.race([service.ready.then(() => 'ready' as const), expired])) === 'expired') {
      throw new Error('stopped before the scripts were read')
    }

    const found = find(name)
    if (typeof found === 'string') return { kind: 'failed', reason: found }

    // Its own header says how long it may take, counted from the send, not from now.
    if (found.meta.interceptor && found.meta.interceptor !== seconds) {
      seconds = found.meta.interceptor
      arm()
    }

    const value = await Promise.race([
      service.intercept(found.path, input, runSignal),
      // A script that ignores its signal still loses the race: what it returns later is dropped.
      expired.then(() => {
        throw new Error('Script stopped')
      }),
    ])

    const read = readInterceptResult(value, input.message)
    if (read.kind === 'invalid') return { kind: 'failed', reason: read.reason }
    if (read.kind !== 'send') return read
    const { policy, ...rest } = read
    const fields = value as Record<string, unknown> | null | undefined
    const rewriteRequested =
      typeof value === 'string' ||
      (typeof value === 'object' &&
        fields != null &&
        (fields.text !== undefined || fields.attachments !== undefined))
    return {
      ...rest,
      ...(rewriteRequested ? { rewriteRequested: true } : {}),
      ...(policy ? { policy: toolPolicy(policy, name, {
        signal: runSignal,
        onTimeout: () => controller.abort(),
      }) } : {}),
    }
  } catch (err) {
    if (timedOut) {
      return { kind: 'failed', reason: `the script did not decide within ${seconds} s` }
    }
    if (signal.aborted) return { kind: 'stopped' }
    return { kind: 'failed', reason: err instanceof Error ? err.message : String(err) }
  } finally {
    window.clearTimeout(timer)
  }
}
