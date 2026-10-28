import type { RequestsContext } from './RequestsService'

/** A tab's project takes precedence over a device's remembered requests project. */
export function projectOfTab(state: unknown): RequestsContext | undefined {
  if (!state || typeof state !== 'object') return undefined
  const sourceTarget = (
    state as {
      sourceTarget?: {
        provider?: string
        source?: { provider?: string; node?: unknown; project?: unknown; workspace?: unknown }
      }
    }
  ).sourceTarget
  const source = sourceTarget?.provider === 'node' ? sourceTarget.source : undefined
  if (
    source?.provider === 'node' &&
    typeof source.node === 'string' &&
    typeof source.project === 'string' &&
    typeof source.workspace === 'string'
  )
    return { registrationId: source.node, projectId: source.project, worktreeId: source.workspace }
  const target = (state as { target?: unknown }).target
  const value = target && typeof target === 'object' ? target : state
  const c = value as Partial<RequestsContext>
  return typeof c.registrationId === 'string' && typeof c.projectId === 'string'
    ? {
        registrationId: c.registrationId,
        projectId: c.projectId,
        ...(typeof c.worktreeId === 'string' ? { worktreeId: c.worktreeId } : {}),
      }
    : undefined
}

/** Repeated pages do not create repeated choices; equal names retain distinct identities. */
export function distinctProjects(contexts: RequestsContext[]): RequestsContext[] {
  const seen = new Set<string>()
  const unique = contexts.filter((c) => {
    const key = JSON.stringify([c.registrationId, c.projectId, c.worktreeId ?? null])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return unique.map((c) =>
    unique.some((other) => other !== c && other.label === c.label && other.node === c.node)
      ? { ...c, label: `${c.label ?? 'Project'} · ${c.worktreeId ?? c.projectId}` }
      : c
  )
}

/** Only a URL actually printed by the program is a known address. */
export function serverAddress(output: string): string | undefined {
  const matches = output.match(
    /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d{1,5}(?:\/[^\s]*)?/g
  )
  const last = matches?.at(-1)
  if (!last) return undefined
  try {
    return new URL(last).origin
  } catch {
    return undefined
  }
}
