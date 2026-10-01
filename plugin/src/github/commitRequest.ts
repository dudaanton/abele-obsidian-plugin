import type { GithubTarget } from './urls'
import { text, whole } from './toolParameters'

export type CommitRequest =
  | { kind: 'commit'; sha: string }
  | { kind: 'compare'; base?: string; head: string }
  | { kind: 'pull-commits'; number: number }
  | { kind: 'commit-history'; ref: string; path: string; page: number }

/** One interpretation for both execution and access probes, including parameter precedence. */
export function commitRequest(
  named: { target?: GithubTarget; number?: number },
  params: Record<string, unknown>
): CommitRequest {
  const t = named.target
  const sha = text(params.sha) || (t?.kind === 'commit' ? t.sha : '')
  if (sha) return { kind: 'commit', sha }
  const head = text(params.head) || (t?.kind === 'compare' ? t.head : '')
  const base = text(params.base) || (t?.kind === 'compare' ? t.base : undefined)
  if (head && (base || t?.kind === 'compare')) return { kind: 'compare', head, base }
  if (base || head) throw new Error('A comparison needs both base and head.')
  const explicitPull = params.pull !== undefined ? whole(params.pull, 0) || undefined : undefined
  const pull =
    explicitPull ??
    (t?.kind === 'pull' || t?.kind === 'issue' ? t.number : !t ? named.number : undefined)
  if (pull) return { kind: 'pull-commits', number: pull }
  return {
    kind: 'commit-history',
    ref: text(params.ref),
    path: text(params.path),
    page: whole(params.page, 1),
  }
}

export function commitHistoryQuery(
  request: Extract<CommitRequest, { kind: 'commit-history' }>,
  perPage: number
): string {
  return [
    request.ref ? `sha=${encodeURIComponent(request.ref)}` : '',
    request.path ? `path=${encodeURIComponent(request.path)}` : '',
    `per_page=${perPage}`,
    `page=${request.page}`,
  ]
    .filter(Boolean)
    .join('&')
}
