const text = (v: unknown) => (typeof v === 'string' ? v : '')
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
export const piFailure = (data: Record<string, unknown>): string => {
  const snapshot = object(data.message)
  if (snapshot.role !== 'assistant' || snapshot.stopReason !== 'error') return ''
  const raw = text(snapshot.errorMessage).trim()
  const retainedStatus = data.http_status
  const status =
    typeof retainedStatus === 'number' &&
    Number.isInteger(retainedStatus) &&
    retainedStatus >= 400 &&
    retainedStatus < 600
      ? retainedStatus
      : raw.match(/\b(?:HTTP\s*)?([45]\d{2})\b/i)?.[1]
  const plain = /provider_error|\bSDK\b|\bjournal\b/i.test(raw)
    ? ''
    : raw.split(/\r?\n/)[0].slice(0, 240)
  const reason = status
    ? `the model service returned an error (HTTP ${status})`
    : plain || 'the model service returned an error'
  return `The agent could not answer: ${reason}.`
}
