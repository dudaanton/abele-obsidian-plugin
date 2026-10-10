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
  /** Monotonic resolution identities, saved with the decision, never inferred from absence. */
  resolved?: string[]
  tools?: Record<string, 'executing' | 'interrupted' | 'done'>
}
export interface AttentionReason {
  kind: 'approval' | 'question' | 'error' | 'interrupted' | 'running' | 'delivery'
  id: string
  at: number
  target?: string
  text?: string
  expires?: number
  interrupted?: boolean
  uncertain?: boolean
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
  model?: string
  folder?: string
  quote?: string
  reasons: AttentionReason[]
  updatedAt?: number
  uncertain?: boolean
}
export const needsAttention = (r: AttentionReason): boolean =>
  ['approval', 'question', 'error', 'interrupted'].includes(r.kind)

/** A stale/uncertain request may be dismissed, but a live approval is reviewed in its chat. */
export const canDismissAttention = (reason: AttentionReason): boolean =>
  reason.kind === 'error' ||
  reason.kind === 'interrupted' ||
  (['approval', 'question'].includes(reason.kind) && !!(reason.uncertain || reason.interrupted))
export function attentionReasons(
  state: LocalAttention,
  approvals: { id: string; name: string }[],
  live: boolean
): AttentionReason[] {
  const settled = settledAttention(state)
  const reasons: AttentionReason[] = approvals
    .filter((p) => !settled.has(p.id) && !state.tools?.[p.id])
    .map((p) => ({
      kind: 'approval',
      id: p.id,
      at: state.approvals?.[p.id] ?? 0,
      text: p.name,
    }))
  for (const [id, status] of Object.entries(state.tools ?? {}))
    if (status !== 'done' && !settled.has(id))
      reasons.push({
        kind: live && status === 'executing' ? 'running' : 'interrupted',
        id,
        at: state.approvals?.[id] ?? 0,
      })
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
  return reasons.filter((r) => !settled.has(r.id))
}

/** Positive terminal facts. Missing fields and missing requests prove nothing. */
export function settledAttention(state: LocalAttention): Set<string> {
  return new Set([
    ...(state.resolved ?? []),
    ...(state.errors ?? []).filter((e) => e.seen).map((e) => e.id),
    ...(state.run?.status === 'done' ? [state.run.id] : []),
    ...(state.question && ['answered', 'cancelled'].includes(state.question.status)
      ? [state.question.id]
      : []),
    ...Object.entries(state.tools ?? {})
      .filter(([, status]) => status === 'done')
      .map(([id]) => id),
  ])
}

/** One ledger rule: union arrivals, subtract only positively committed resolutions. */
export function reconcileAttentionReasons(
  indexed: AttentionReason[],
  incoming: AttentionReason[],
  truth: LocalAttention = {},
  uncertain = false
): AttentionReason[] {
  const settled = settledAttention(truth)
  const next = new Map(indexed.filter((r) => !settled.has(r.id)).map((r) => [r.id, { ...r }]))
  for (const reason of incoming) if (!settled.has(reason.id)) next.set(reason.id, { ...reason })
  for (const [id, reason] of next) {
    if (truth.tools?.[id] === 'executing' && reason.kind === 'approval')
      next.set(id, { ...reason, kind: 'interrupted' })
    if (
      uncertain ||
      (!['running', 'interrupted'].includes(reason.kind) && !incoming.some((r) => r.id === id))
    )
      next.set(id, { ...next.get(id)!, uncertain: true })
  }
  return [...next.values()]
}

/** Merge disk decisions monotonically into a local holder, without resuming anything. */
export function mergeAttentionTruth(local: LocalAttention, disk: LocalAttention): LocalAttention {
  const resolved = new Set([...settledAttention(local), ...settledAttention(disk)])
  const errors = new Map((disk.errors ?? []).map((e) => [e.id, { ...e }]))
  for (const error of local.errors ?? [])
    errors.set(error.id, {
      ...error,
      seen: error.seen || errors.get(error.id)?.seen || resolved.has(error.id) || undefined,
    })
  const question =
    local.question?.id === disk.question?.id &&
    disk.question &&
    ['answered', 'cancelled'].includes(disk.question.status)
      ? disk.question
      : (local.question ?? disk.question)
  return {
    ...local,
    ...(resolved.size || local.resolved !== undefined || disk.resolved !== undefined
      ? { resolved: [...resolved] }
      : {}),
    ...(local.errors !== undefined || disk.errors !== undefined
      ? { errors: [...errors.values()] }
      : {}),
    ...(local.tools !== undefined || disk.tools !== undefined
      ? { tools: { ...local.tools, ...disk.tools } }
      : {}),
    ...(local.run || disk.run
      ? {
          run: local.run
            ? {
                ...local.run,
                status: resolved.has(local.run.id) ? ('done' as const) : local.run.status,
              }
            : disk.run,
        }
      : {}),
    ...(question
      ? {
          question: {
            ...question,
            status: resolved.has(question.id)
              ? question.status === 'answered'
                ? ('answered' as const)
                : ('cancelled' as const)
              : question.status,
          },
        }
      : {}),
  }
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
  if (reason.uncertain) return 'Состояние не подтверждено · Данные запроса могли не сохраниться'
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
