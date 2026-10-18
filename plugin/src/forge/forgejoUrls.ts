import { UiError, uiMessage } from '@/i18n/streamBErrors'
import type { GithubTarget } from '@/github/urls'
import type { Deployment } from './model'
import { isMarkdownPath } from '@/github/markdownPreview'

const segment = (value: string) => {
  if (
    !value ||
    value === '.' ||
    value === '..' ||
    value.includes('\\') ||
    [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    throw new UiError(uiMessage('streamBError.b83e5c8317'))
  return encodeURIComponent(value)
}
const pathParts = (value: string) => value.split('/').map(segment).join('/')

/** Only configured deployment routes are interpreted; unsupported routes stay browser exits. */
export function forgejoUrls(base: Deployment) {
  const repository = (repo: string) => {
    if (repo.split('/').length !== 2) throw new UiError(uiMessage('streamBError.8016408637'))
    return `${base.webBase}/${pathParts(repo)}`
  }
  const file = (
    repo: string,
    ref: string,
    path: string,
    lines?: { from: number; to: number },
    refKind?: 'branch' | 'tag' | 'commit'
  ) => {
    const kind = refKind ?? (/^[a-f\d]{40}$/i.test(ref) ? 'commit' : 'branch')
    const anchor = lines ? `#L${lines.from}${lines.to > lines.from ? `-L${lines.to}` : ''}` : ''
    const plain = lines && isMarkdownPath(path) ? '?display=source' : ''
    return `${repository(repo)}/src/${kind}/${segment(ref)}${path ? `/${pathParts(path)}` : ''}${plain}${anchor}`
  }
  const parse = (address: string): GithubTarget | null => {
    try {
      // URL normalizes dot segments; reject them before parsing so they cannot change identity.
      const rawPath = address.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]+/i, '').split(/[?#]/)[0]
      for (const part of rawPath.split('/').filter(Boolean)) {
        const decoded = decodeURIComponent(part)
        if (decoded.split('/').some((p) => p === '.' || p === '..')) return null
        segment(decoded)
      }
      const url = new URL(address),
        deployment = new URL(base.webBase)
      if (url.username || url.password || url.origin !== deployment.origin) return null
      if ([...url.searchParams.keys()].some((key) => /token|authorization|password/i.test(key)))
        return null
      const prefix = `${deployment.pathname.replace(/\/$/, '')}/`
      if (!url.pathname.startsWith(prefix)) return null
      const [owner, repo, ...rest] = url.pathname
        .slice(prefix.length)
        .split('/')
        .map(decodeURIComponent)
      if (!owner || !repo || [owner, repo].some((part) => part.includes('/'))) return null
      const shared = {
        provider: base.kind === 'gitea' ? ('gitea' as const) : ('forgejo' as const),
        host: url.hostname,
        origin: base.webBase,
        owner,
        repo,
        anchor: url.hash.slice(1),
      }
      if (!rest.length || (rest.length === 1 && !rest[0])) return { ...shared, kind: 'repo' }
      if (rest.length === 1 && ['issues', 'pulls', 'discussions'].includes(rest[0]))
        return {
          ...shared,
          kind: 'list',
          list: rest[0] as 'issues' | 'pulls' | 'discussions',
          query: url.searchParams.get('q') ?? '',
        }
      if (rest[0] === 'discussions' && /^[1-9]\d*$/.test(rest[1]) && rest.length === 2)
        return { ...shared, kind: 'discussion', number: Number(rest[1]) }
      if (rest[0] === 'issues' && /^[1-9]\d*$/.test(rest[1]) && rest.length === 2)
        return { ...shared, kind: 'issue', number: Number(rest[1]) }
      if (rest[0] === 'pulls' && /^[1-9]\d*$/.test(rest[1]) && rest.length <= 3) {
        const tab = rest[2] || 'conversation'
        if (!['conversation', 'files', 'commits'].includes(tab)) return null
        return {
          ...shared,
          kind: 'pull',
          number: Number(rest[1]),
          tab: tab as 'conversation' | 'files' | 'commits',
        }
      }
      if (rest[0] === 'src' && ['branch', 'tag', 'commit'].includes(rest[1]) && rest[2]) {
        const match = /^L([1-9]\d*)(?:-L([1-9]\d*))?$/.exec(url.hash.slice(1))
        return {
          ...shared,
          kind: 'blob',
          refKind: rest[1] as 'branch' | 'tag' | 'commit',
          rest: rest.slice(2),
          plain: url.searchParams.get('display') === 'source',
          ...(match
            ? { lines: { start: Number(match[1]), end: Number(match[2] ?? match[1]) } }
            : {}),
        }
      }
      if (rest[0] === 'commit' && /^[a-f\d]{40}$/i.test(rest[1]) && rest.length === 2)
        return { ...shared, kind: 'commit', sha: rest[1] }
      if (rest[0] === 'compare' && rest.length === 2) {
        const match = /^(.+?)(\.\.\.?)(.+)$/.exec(rest[1])
        if (match)
          return {
            ...shared,
            kind: 'compare',
            base: match[1],
            head: match[3],
            direct: match[2] === '..',
          }
      }
      return null
    } catch {
      return null
    }
  }
  return { repository, file, parse }
}
