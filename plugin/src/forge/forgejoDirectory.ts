import type { RepoEntry, AccountRepos } from '@/github/open/repoList'
import type { OpenRow } from '@/github/open/search'
import { forgejoRepository } from './forgejoRepository'
import { forgejoUrls } from './forgejoUrls'
import { nativeLabel } from './native'
import type { ForgejoClient } from './forgejoClient'

interface RawRepo {
  name: string
  owner: { login: string }
  description?: string
  private?: boolean
  fork?: boolean
  archived?: boolean
  stars_count?: number
}
const entry = (client: ForgejoClient, raw: RawRepo): RepoEntry => ({
  provider: client.deployment.kind === 'gitea' ? 'gitea' : 'forgejo',
  host: new URL(client.deployment.webBase).hostname,
  origin: client.deployment.webBase,
  owner: raw.owner.login,
  repo: raw.name,
  description: raw.description,
  private: raw.private,
  fork: raw.fork,
  archived: raw.archived,
  stars: raw.stars_count,
})
export async function nativeAccountRepos(client: ForgejoClient): Promise<AccountRepos> {
  const [own, starred] = await Promise.allSettled([
    client.pages<RawRepo>('/user/repos'),
    client.pages<RawRepo>('/user/starred'),
  ])
  client.session.assertCurrent()
  return {
    own: own.status === 'fulfilled' ? own.value.value.map((row) => entry(client, row)) : [],
    starred:
      starred.status === 'fulfilled' ? starred.value.value.map((row) => entry(client, row)) : [],
    problem: [own, starred].some((r) => r.status === 'rejected')
      ? 'Some account repository lists could not be read.'
      : [own, starred].some((r) => r.status === 'fulfilled' && !r.value.complete)
        ? 'Repository lists are incomplete; search to narrow them.'
        : undefined,
  }
}
export async function nativeSearchRepos(
  client: ForgejoClient,
  query: string
): Promise<RepoEntry[]> {
  const answer = await client.get<{ data: RawRepo[] }>(
    `/repos/search?q=${encodeURIComponent(query)}&limit=20&page=1`
  )
  if (!Array.isArray(answer.data))
    throw new Error('The service did not return a repository search result.')
  return answer.data.map((row) => entry(client, row))
}
export async function nativeOpenRows(
  client: ForgejoClient,
  context: string | null,
  input: string
): Promise<OpenRow[]> {
  const urls = forgejoUrls(client.deployment),
    text = input.trim()
  const named = /^([\w.-]+\/[\w.-]+)(?:#(\d+)|\s+(.*))?$/.exec(text)
  const repository = named?.[1] ?? context
  const query = named ? (named[2] ? `#${named[2]}` : (named[3] ?? '')) : text
  const note = `${nativeLabel(client.deployment.kind)} · ${client.deployment.webBase}`
  if (named && !named[2] && !named[3]) {
    const direct: OpenRow = { kind: 'repo', title: named[1], note, url: urls.repository(named[1]) }
    if (!context) return [direct]
    const source = forgejoRepository(client, context)
    const refs = await source.refs()
    return [
      direct,
      ...refs.branches
        .filter((ref) => ref === text)
        .map(
          (ref): OpenRow => ({
            kind: 'branch',
            title: ref,
            note,
            url: source.navigation.ref('branch', ref),
          })
        ),
    ]
  }
  if (!repository) {
    if (!text) return [{ kind: 'note', title: 'Type owner/repo or a repository name.', note }]
    return (await nativeSearchRepos(client, text)).map((repo) => ({
      kind: 'repo',
      title: `${repo.owner}/${repo.repo}`,
      note: `${note}${repo.description ? ` · ${repo.description}` : ''}`,
      repo,
      url: urls.repository(`${repo.owner}/${repo.repo}`),
    }))
  }
  const source = forgejoRepository(client, repository)
  const api = `/repos/${repository.split('/').map(encodeURIComponent).join('/')}`
  if (/^#?\d+$/.test(query)) {
    const number = Number(query.replace('#', ''))
    const item = await client.get<{ title: string; pull_request?: unknown }>(
      `${api}/issues/${number}`
    )
    return [
      {
        kind: item.pull_request ? 'pull' : 'issue',
        title: `#${number} ${item.title}`,
        note,
        url: `${urls.repository(repository)}/${item.pull_request ? 'pulls' : 'issues'}/${number}`,
      },
    ]
  }
  if (/^[a-f\d]{7,40}$/i.test(query)) {
    const sha = await source.resolve(query)
    return [{ kind: 'commit', title: sha.slice(0, 12), note, url: source.navigation.commit(sha) }]
  }
  const comparison = /^(.+?)(\.\.\.?)(.+)$/.exec(query)
  if (comparison)
    return [
      {
        kind: 'compare',
        title: query,
        note,
        url: source.navigation.comparison(comparison[1], comparison[3], comparison[2] === '..'),
      },
    ]
  const refs = await source.refs()
  const rows: OpenRow[] = [
    ...refs.branches
      .filter((ref) => !query || ref.toLowerCase().includes(query.toLowerCase()))
      .map(
        (ref): OpenRow => ({
          kind: 'branch',
          title: ref,
          note,
          url: source.navigation.ref('branch', ref),
        })
      ),
    ...refs.tags
      .filter((ref) => !query || ref.toLowerCase().includes(query.toLowerCase()))
      .map(
        (ref): OpenRow => ({
          kind: 'branch',
          title: ref,
          note: `Tag · ${note}`,
          url: source.navigation.ref('tag', ref),
        })
      ),
  ]
  if (!query)
    rows.unshift(
      { kind: 'repo', title: repository, note, url: urls.repository(repository) },
      ...(['issues', 'pulls'] as const).map(
        (kind): OpenRow => ({
          kind: 'list',
          title: kind,
          note,
          url: `${urls.repository(repository)}/${kind}`,
        })
      )
    )
  else {
    const result = (await source.github.loadTarget(
      {
        kind: 'list',
        provider: client.deployment.kind === 'gitea' ? 'gitea' : 'forgejo',
        host: new URL(client.deployment.webBase).hostname,
        origin: client.deployment.webBase,
        owner: repository.split('/')[0],
        repo: repository.split('/')[1],
        list: 'issues',
        query,
      },
      () => {}
    )) as import('@/github/lists/listData').ListData
    rows.push(
      ...result.items.map(
        (item): OpenRow => ({
          kind: item.kind,
          title: `#${item.number} ${item.title}`,
          url: item.url,
          note: result.note ? `${note} · ${result.note}` : note,
        })
      )
    )
    const pulls = await client.pages<{ number: number; title: string }>(`${api}/pulls?state=all`)
    rows.push(
      ...pulls.value
        .filter((p) => p.title.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 25)
        .map(
          (p): OpenRow => ({
            kind: 'pull',
            title: `#${p.number} ${p.title}`,
            note: `${note}${pulls.complete ? '' : ' · Incomplete title search'}`,
            url: `${urls.repository(repository)}/pulls/${p.number}`,
          })
        )
    )
  }
  client.session.assertCurrent()
  return rows.slice(0, 50)
}
