// The small pieces the requests model is made of: names of files, times in words, an answer as
// the tab draws it, and the environments' secrets held in memory.
import type { HttpOutcome, HttpPair, HttpResponse } from '@/components/debugger/http/types'
import type { HttpRpc, SendStatus, WireOutcome } from './wire'
import { t } from '@/i18n'

/** Secrets of environments, by project and environment: they outlive a closed view. */
/** A secret held in memory, and the origin it came from: it goes only there. */
export interface HeldSecret {
  value: string
  origin?: string
}
export const SECRETS = new Map<string, Record<string, HeldSecret>>()

/** `https://host:port` of an address, or nothing when it is not one. */
export function originOf(url: string): string | undefined {
  try {
    const u = new URL(url)
    return /^https?:$/.test(u.protocol) ? u.origin : undefined
  } catch {
    return undefined
  }
}

/** Forgets every secret held in memory: when the plugin unloads, and between tests. */
export function forgetRequestSecrets() {
  SECRETS.clear()
}

const FORBIDDEN = /[\\/:*?"<>|\0]/g
export function requestIdFor(collection: string, name: string) {
  // A folder is plain names: nothing that climbs out of the requests folder or hides in it.
  collection = collection
    .split(/[\\/]/)
    .map((part) =>
      part
        .replace(FORBIDDEN, '-')
        .replace(/^[\s.]+/, '')
        .trim()
    )
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/')
  const file =
    name
      .replace(FORBIDDEN, '-')
      .replace(/^[\s.]+/, '')
      .trim()
      .slice(0, 120) || 'Request'
  return `${collection ? `${collection}/` : ''}${file}.http`
}
export const collectionOf = (id: string) =>
  id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : ''

const pad = (n: number) => String(n).padStart(2, '0')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** `05:12` today, `Yesterday 18:40`, `3 Sep 09:05` before that. */
export function sentAtWords(iso: string, now = new Date()) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(now) - day(d)) / 86_400_000)
  if (days === 0) return time
  if (days === 1) return `Yesterday ${time}`
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${time}`
}

export const reasonOf = (e: unknown) => {
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Unknown failure'
  return message === 'http_request_not_found' ? t('node.error.requestMissing') : message
}

export function outcomeOf(outcome: WireOutcome, codeSteps?: number): HttpOutcome {
  switch (outcome.state) {
    case 'sending':
      return { kind: 'sending' }
    case 'failed':
      return { kind: 'failed', reason: outcome.reason }
    case 'unknown':
      return {
        kind: 'unknown',
        after: outcome.after_ms ? `${Math.max(1, Math.round(outcome.after_ms / 1000))} s` : 'time',
        reason: outcome.reason,
      }
    case 'answered': {
      const r = outcome.response
      const response: HttpResponse = {
        status: r.status,
        reason: r.reason,
        ms: r.ms,
        bytes: r.bytes,
        headers: r.headers.map((h): HttpPair => ({ key: h.key, value: h.value })),
        body: r.body,
        ...(codeSteps ? { steps: codeSteps } : {}),
        ...(r.cut ? { cut: true } : {}),
      }
      return { kind: 'answered', response }
    }
  }
}

/** Reads a send until its answer is in. Losing the node on the way never sends it again. */
export async function followSend(
  rpc: HttpRpc,
  projectId: string,
  sendId: string,
  wait: (ms: number) => Promise<void>,
  signal?: AbortSignal
): Promise<SendStatus> {
  let delay = 100
  let failedReads = 0
  for (;;) {
    let status: SendStatus
    try {
      status = await rpc.status(projectId, sendId)
    } catch (e) {
      console.debug('[requests] Send not followed', e)
      const code =
        e && typeof e === 'object' && 'code' in e
          ? e.code
          : e instanceof Error
            ? e.message
            : undefined
      if (
        !signal?.aborted &&
        (code === 'request_timeout' || code === 'outcome_unknown') &&
        ++failedReads <= 2
      ) {
        // Read the existing send again; never dispatch the HTTP request a second time.
        await wait(1000)
        continue
      }
      return {
        send: { id: sendId, at: new Date().toISOString(), method: 'GET', url: '' },
        outcome: {
          state: 'unknown',
          reason: reasonOf(e),
          after_ms: 0,
        },
      }
    }
    if (status.outcome.state !== 'sending') return status
    if (signal?.aborted)
      return {
        send: status.send,
        outcome: {
          state: 'unknown',
          reason: 'Stopped waiting. It may have gone through; it is not sent again by itself.',
          after_ms: 0,
        },
      }
    await wait(delay)
    delay = Math.min(1000, delay * 2)
  }
}
