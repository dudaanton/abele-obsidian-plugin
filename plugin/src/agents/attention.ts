/** Execution state, not conversation content. No host or model dependencies. */
export interface LocalAttention {
  run?: { id: string; at: number; status: 'running' | 'interrupted' | 'done'; target?: string }
  errors?: { id: string; at: number; text: string; target?: string; seen?: boolean }[]
  question?: {
    id: string
    at: number
    target?: string
    status: 'waiting' | 'interrupted' | 'answered' | 'cancelled'
    questions: { question: string; options: string[] }[]
    currentIndex: number
    answers: string[]
  }
  approvals?: Record<string, number>
}
export interface AttentionReason {
  kind: 'approval' | 'question' | 'error' | 'interrupted' | 'running' | 'delivery'
  id: string
  at: number
  target?: string
  text?: string
  expires?: number
  interrupted?: boolean
}
export type AttentionReference =
  | { kind: 'local'; path: string; commentId?: string; sessionId?: string }
  | { kind: 'node'; registrationId: string; nodeId: string; sessionId: string }
export interface AttentionRow {
  key: string
  reference: AttentionReference
  title: string
  agent: string
  source: string
  quote?: string
  reasons: AttentionReason[]
  updatedAt?: number
}
export const needsAttention = (r: AttentionReason): boolean =>
  ['approval', 'question', 'error', 'interrupted'].includes(r.kind)
export function attentionReasons(
  state: LocalAttention,
  approvals: { id: string; name: string }[],
  live: boolean
): AttentionReason[] {
  const reasons: AttentionReason[] = approvals.map((p) => ({
    kind: 'approval',
    id: p.id,
    at: state.approvals?.[p.id] ?? 0,
    text: p.name,
  }))
  const question = state.question
  if (question && ['waiting', 'interrupted'].includes(question.status))
    reasons.push({
      kind: 'question',
      id: question.id,
      at: question.at,
      text: question.questions[question.currentIndex]?.question,
      target: question.target,
      interrupted: !live || question.status === 'interrupted',
    })
  for (const error of state.errors ?? [])
    if (!error.seen)
      reasons.push({
        kind: 'error',
        id: error.id,
        at: error.at,
        text: error.text,
        target: error.target,
      })
  if (state.run && state.run.status !== 'done')
    reasons.push({
      kind: live && state.run.status === 'running' ? 'running' : 'interrupted',
      id: state.run.id,
      at: state.run.at,
      ...(state.run.target ? { target: state.run.target } : {}),
    })
  return reasons
}
export function attentionBadge(rows: AttentionRow[], incomplete: boolean) {
  const attention = rows.filter((r) => r.reasons.some(needsAttention)).length
  const running = rows.filter(
    (r) => !r.reasons.some(needsAttention) && r.reasons.some((s) => s.kind === 'running')
  ).length
  return {
    attention,
    running,
    incomplete,
    mark: attention ? String(attention) : running ? '·' : '',
  }
}
export function sortAttention(rows: AttentionRow[]): AttentionRow[] {
  const order = (row: AttentionRow) => {
    const waiting = row.reasons.filter(needsAttention)
    return [
      Math.min(...waiting.map((r) => r.expires ?? Infinity)),
      Math.min(...(waiting.length ? waiting : row.reasons).map((r) => r.at)),
    ]
  }
  return [...rows].sort((a, b) => {
    const x = order(a),
      y = order(b)
    return (x[0] === y[0] ? 0 : x[0] - y[0]) || x[1] - y[1] || a.key.localeCompare(b.key)
  })
}
/** The index proves a failure happened even if its detailed file write was lost. */
export function restoreIndexedErrors(
  state: LocalAttention,
  reasons: AttentionReason[]
): NonNullable<LocalAttention['errors']> {
  const errors = [...(state.errors ?? [])]
  for (const reason of reasons)
    if (reason.kind === 'error' && !errors.some((e) => e.id === reason.id)) {
      errors.push({
        id: reason.id,
        at: reason.at,
        target: reason.target,
        text: reason.text ?? 'Подробности ошибки не сохранились.',
      })
    }
  return errors
}

export function reasonLabel(reason: AttentionReason): string {
  switch (reason.kind) {
    case 'approval':
      return `Разрешение: ${reason.text ?? ''}`
    case 'question':
      return `${reason.interrupted ? 'Работа прервалась · ' : ''}${reason.text ?? 'Ждёт ответа'}`
    case 'error':
      return `Запуск завершился с ошибкой: ${reason.text ?? ''}`
    case 'interrupted':
      return 'Работа прервалась'
    case 'running':
      return 'Работает · На этом устройстве'
    case 'delivery':
      return reason.text ?? 'Обновляется'
  }
}
