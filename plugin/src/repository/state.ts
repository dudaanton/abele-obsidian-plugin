import type { GithubTarget } from '@/github/urls'
import type { RepositoryTarget, RepositoryRevision, RepositoryLocation } from './source'

/** GitHub conversations retain their web URL; node targets contain only opaque IDs and paths. */
export type RepositoryTabTarget =
  | {
      provider: 'github'
      connection: string
      server: string
      repository: string
      url: string
      revision?: RepositoryRevision
    }
  | ({ provider: 'node' } & RepositoryTarget)

export function githubTabTarget(
  url: string,
  target: GithubTarget,
  connection = '',
  revision?: RepositoryRevision
): RepositoryTabTarget {
  return {
    provider: 'github',
    connection,
    server: target.origin ?? `https://${target.host}`,
    repository: `${target.owner}/${target.repo}`,
    url,
    ...(revision ? { revision } : {}),
  }
}

/** Only a valid GitHub target can supply a URL. Unknown providers never fall through to HTTP. */
export function savedGithubTarget(
  state: unknown
): Extract<RepositoryTabTarget, { provider: 'github' }> | null {
  if (!state || typeof state !== 'object') return null
  const target = (state as { sourceTarget?: unknown }).sourceTarget
  if (!target || typeof target !== 'object') return null
  const row = target as Record<string, unknown>
  if (
    row.provider !== 'github' ||
    !['connection', 'server', 'repository', 'url'].every((key) => typeof row[key] === 'string')
  )
    return null
  try {
    const server = new URL(row.server as string),
      url = new URL(row.url as string)
    if (
      !['https:', 'http:'].includes(server.protocol) ||
      server.username ||
      server.password ||
      url.username ||
      url.password ||
      server.origin !== url.origin
    )
      return null
    const revision = row.revision as Record<string, unknown> | undefined
    const resolved: RepositoryRevision | undefined =
      revision?.kind === 'commit' &&
      typeof revision.commit === 'string' &&
      /^[a-f\d]{40}$/i.test(revision.commit)
        ? { kind: 'commit', commit: revision.commit }
        : undefined
    return {
      provider: 'github',
      connection: row.connection as string,
      server: server.origin,
      repository: row.repository as string,
      url: row.url as string,
      ...(resolved ? { revision: resolved } : {}),
    }
  } catch {
    return null
  }
}

export function savedNodeTarget(
  state: unknown
): Extract<RepositoryTabTarget, { provider: 'node' }> | null {
  if (!state || typeof state !== 'object') return null
  const target = (state as { sourceTarget?: unknown }).sourceTarget
  if (!target || typeof target !== 'object') return null
  const row = target as Record<string, unknown>
  if (
    row.provider !== 'node' ||
    !row.source ||
    typeof row.source !== 'object' ||
    !row.location ||
    typeof row.location !== 'object'
  )
    return null
  const identity = row.source as Record<string, unknown>,
    location = row.location as Record<string, unknown>
  const id = (value: unknown): value is string =>
    typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value)
  if (
    identity.provider !== 'node' ||
    !['installation', 'node', 'project', 'workspace'].every((key) => id(identity[key]))
  )
    return null
  const hasControl = (value: string) => [...value].some((character) => character.charCodeAt(0) < 32)
  const text = (value: unknown): value is string =>
    typeof value === 'string' && !!value && !hasControl(value)
  if (location.kind === 'file' || location.kind === 'folder') {
    if (
      !text(location.ref) ||
      typeof location.path !== 'string' ||
      location.path.includes('\\') ||
      location.path.startsWith('/') ||
      hasControl(location.path) ||
      location.path.split('/').some((part) => ['.', '..', '.git'].includes(part.toLowerCase()))
    )
      return null
    if (location.kind === 'file' && !location.path) return null
    if (location.contentId !== undefined && (location.kind !== 'file' || !id(location.contentId))) return null
  } else if (location.kind === 'home') {
    if (location.ref !== undefined && !text(location.ref)) return null
  } else if (location.kind === 'commit') {
    if (!id(location.commit)) return null
  } else if (location.kind === 'comparison') {
    if (!text(location.head) || (location.base !== undefined && !text(location.base))) return null
    if (location.mode !== undefined && !['endpoint', 'merge-base', 'staged', 'unstaged'].includes(location.mode as string)) return null
  } else return null
  const selection = location.lines as Record<string, unknown> | undefined
  if (
    selection &&
    (typeof selection !== 'object' ||
      !Number.isSafeInteger(selection.from) ||
      !Number.isSafeInteger(selection.to) ||
      (selection.from as number) < 1 ||
      (selection.to as number) < (selection.from as number))
  )
    return null
  const revision = row.revision as Record<string, unknown> | undefined
  if (revision) {
    if (revision.kind === 'commit') {
      if (!id(revision.commit)) return null
    } else if (revision.kind === 'working-tree') {
      if (
        (revision.head !== null && !id(revision.head)) ||
        !id(revision.observation) ||
        typeof revision.observedAt !== 'string' ||
        !Number.isFinite(Date.parse(revision.observedAt))
      )
        return null
    } else return null
  }
  // Whitelist the fields rather than persisting arbitrary imported state (credentials, grants).
  const source = {
    provider: 'node' as const,
    installation: identity.installation as string,
    node: identity.node as string,
    project: identity.project as string,
    workspace: identity.workspace as string,
  }
  const cleanLocation: RepositoryLocation =
    location.kind === 'home'
      ? { kind: 'home' as const, ...(location.ref ? { ref: location.ref as string } : {}) }
      : location.kind === 'commit'
        ? { kind: 'commit' as const, commit: location.commit as string }
        : location.kind === 'comparison'
          ? {
              kind: 'comparison' as const,
              head: location.head as string,
              ...(location.base ? { base: location.base as string } : {}),
              direct: location.direct !== false,
              ...(location.mode ? { mode: location.mode as 'endpoint' | 'merge-base' | 'staged' | 'unstaged' } : {}),
            }
          : {
              kind: location.kind,
              ref: location.ref as string,
              path: location.path as string,
              ...(location.contentId ? { contentId: location.contentId as string } : {}),
              ...(selection
                ? { lines: { from: selection.from as number, to: selection.to as number } }
                : {}),
            }
  const cleanRevision: RepositoryRevision | undefined =
    revision?.kind === 'commit'
      ? { kind: 'commit', commit: revision.commit as string }
      : revision?.kind === 'working-tree'
        ? {
            kind: 'working-tree',
            head: revision.head as string | null,
            observation: revision.observation as string,
            observedAt: revision.observedAt as string,
          }
        : undefined
  return {
    provider: 'node',
    source,
    location: cleanLocation,
    ...(cleanRevision ? { revision: cleanRevision } : {}),
  }
}
