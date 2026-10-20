import { t } from '@/i18n'
// How a run's numbers read: sizes the way a file list says them, times from the run's start.
import type { TraceStep } from './types'

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** `+0.42 s`, `+1:05`: from the start of the run. */
export function since(ms: number): string {
  if (ms < 60_000) return `+${(ms / 1000).toFixed(2)} s`
  const s = Math.round(ms / 1000)
  return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** What the glyph before a step says, for its tooltip. */
export function kindWords(step: TraceStep): string {
  if (step.kind === 'probe') return t('streamC.87baa9bb75b99f13')
  if (step.kind === 'error') return t('streamC.5f5364de8ce3a57d')
  if (step.kind === 'browser-lost') return t('streamC.4e8d7f10d8e9f475')
  const request = step.sent
    ? t('streamC.fd6ff1c88db4072e')
    : step.direction
      ? t(step.direction === 'incoming' ? 'debug.httpIncoming' : 'debug.httpOutgoing')
      : t('streamC.4fcfb007acf1f0e2')
  return `${request}${step.status !== undefined ? `, ${step.status}` : ''}`
}

/** Everything the step took, in one size. */
export const stepBytes = (step: TraceStep) =>
  [...step.values, ...(step.request ?? []), ...(step.response ?? [])].reduce(
    (n, v) => n + (v.same || v.masked ? 0 : v.bytes),
    0
  )
