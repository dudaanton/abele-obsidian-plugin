import { GlobalStore } from '@/stores/GlobalStore'
import {
  githubSettings,
  parseForSettings,
  resolveConnectionCandidates,
  connectionGeneration,
  openGithubUrl,
} from '@/github/GithubService'
import { authorizeConnection, connectionMode } from '@/github/agentAccess'
import { sameConnectionServer } from '@/github/connectionRouting'
import { isGithubConnection, connectionUnavailableReason } from '@/github/connections'
import { forgejoConnectionClient } from '@/forge/forgejoConnections'
import { forgejoRepository } from '@/forge/forgejoRepository'
import { forgejoUrls } from '@/forge/forgejoUrls'
import { isNativeForge } from '@/forge/native'
import { createGithubViewsTool } from './ViewTools'
import { answer, whole, text, MAX_LINES, DEFAULT_LINES } from './shared'
import type { GithubToolAccess } from './operation'
import type { GithubTarget } from '@/github/urls'
import type { AgentToolResult } from '@/ai/client'
import type { BlobData, FolderData, TreeNode } from '@/repository/model'
import type { ListData } from '@/github/lists/listData'

export function usesNativeTool(params: Record<string, unknown>): boolean {
  const rows = githubSettings().connections ?? []
  const explicit = rows.filter((c) => c.id === params.connection || c.name === params.connection)
  if (explicit.length) return explicit.some((c) => isNativeForge(c.provider))
  const input = text(params.item ?? params.repo ?? params.url)
  const target = parseForSettings(input)
  if (target) return isNativeForge(target.provider)
  return !rows.some(isGithubConnection) && rows.some((c) => isNativeForge(c.provider))
}
const pageOf = <T>(items: T[], page: number, size = 25) => ({
  items: items.slice((page - 1) * size, page * size),
  total: items.length,
  next: items.length > page * size ? page + 1 : null,
})

/** Shared inventory exposes no title or selection from Off or unapproved Ask connections. */
export async function forgeViews(
  params: Record<string, unknown>,
  access: GithubToolAccess,
  signal?: AbortSignal
): Promise<AgentToolResult> {
  const rows = githubSettings().connections ?? [],
    id = access.agent()?.id
  const selected = text(params.connection)
  const matches = rows.filter((c) => c.id === selected || c.name === selected)
  if (selected && matches.length !== 1)
    throw new Error('Unknown or ambiguous connection; use its unique ID.')
  const chosen = matches[0],
    generation = chosen ? connectionGeneration(chosen.id) : ''
  const asked = chosen && connectionMode(access.agent(), chosen.id) === 'ask'
  if (chosen) await authorizeConnection(access.agent, chosen, access.approve, signal)
  const exposed = new Map<string, { mode: string; generation: string }>()
  const result = await createGithubViewsTool({
    inventory: [
      'Git repository connections (Off / Ask / On):',
      ...rows.map(
        (row) =>
          `- ${row.name} [${row.id}] · ${row.provider ?? 'github'} · ${row.server || 'github.com'}${row.account ? ` · ${row.account.login}` : ''} · ${connectionMode(access.agent(), row.id)}${isNativeForge(row.provider) || isGithubConnection(row) ? '' : ` · ${connectionUnavailableReason(row)}`}`
      ),
    ].join('\n'),
    canReadTab: (connection) => {
      const allowed =
        !connection ||
        rows.some(
          (row) =>
            row.id === connection &&
            (isNativeForge(row.provider) || isGithubConnection(row)) &&
            (!selected || chosen?.id === row.id) &&
            (connectionMode(access.agent(), row.id) === 'auto' ||
              (asked &&
                row.id === chosen?.id &&
                connectionMode(access.agent(), row.id) === 'ask' &&
                generation === connectionGeneration(row.id)))
        )
      if (allowed && connection)
        exposed.set(connection, {
          mode: connectionMode(access.agent(), connection),
          generation: connectionGeneration(connection),
        })
      return allowed
    },
  }).execute('forge-views', params)
  if (
    signal?.aborted ||
    [...exposed].some(
      ([key, captured]) =>
        connectionMode(access.agent(), key) !== captured.mode ||
        connectionGeneration(key) !== captured.generation
    ) ||
    id !== access.agent()?.id ||
    (chosen &&
      (connectionMode(access.agent(), chosen.id) === 'off' ||
        (connectionMode(access.agent(), chosen.id) === 'ask' && !asked) ||
        generation !== connectionGeneration(chosen.id)))
  )
    throw new Error('Connection access was revoked during this operation.')
  return result
}

/** Native tools use repository capabilities, never a GitHub client with a substituted base URL. */
export async function runNativeTool(
  name: string,
  params: Record<string, unknown>,
  access: GithubToolAccess,
  signal?: AbortSignal
): Promise<AgentToolResult> {
  const rows = githubSettings().connections ?? [],
    selected = text(params.connection),
    originalAgent = access.agent()?.id
  const matches = rows.filter((c) => c.id === selected || c.name === selected)
  if (selected && matches.length !== 1)
    throw new Error('Unknown or ambiguous connection; use its unique ID.')
  let connection = matches[0]
  const input = text(params.item ?? params.repo ?? params.url)
  let target = parseForSettings(input)
  if (!connection && target) {
    const candidate = resolveConnectionCandidates(target, {
      allowedIds: rows
        .filter((c) => connectionMode(access.agent(), c.id) !== 'off')
        .map((c) => c.id),
    })[0]
    connection = rows.find((c) => c.id === candidate?.id)
  }
  if (!connection) {
    const eligible = rows.filter(
      (c) => isNativeForge(c.provider) && connectionMode(access.agent(), c.id) !== 'off'
    )
    const identities = new Set(eligible.map((c) => `${c.provider}:${c.server}`))
    if (identities.size > 1)
      throw new Error('Ambiguous native repository: choose a connection explicitly.')
    const preferred = eligible.filter((c) => c.isDefault)
    if (eligible.length > 1 && preferred.length !== 1)
      throw new Error('Ambiguous account: choose a connection explicitly.')
    connection = preferred[0] ?? eligible[0]
  }
  if (!connection || !isNativeForge(connection.provider))
    throw new Error('Choose a configured native Git connection.')
  const raw = forgejoConnectionClient(connection.id),
    urls = forgejoUrls(raw.deployment)
  if (!target) {
    const short = /^([\w.-]+\/[\w.-]+)(?:#([1-9]\d*))?$/.exec(input)
    if (!short)
      throw new Error(
        'Name a configured service URL or owner/repo, and choose a connection when ambiguous.'
      )
    target = urls.parse(`${urls.repository(short[1])}${short[2] ? `/issues/${short[2]}` : ''}`)
  }
  if (!target || !sameConnectionServer(connection, target))
    throw new Error('The item belongs to another provider or deployment.')
  const generation = raw.session.generation
  const asked = connectionMode(access.agent(), connection.id) === 'ask'
  await authorizeConnection(access.agent, connection, access.approve, signal)
  const assertAccess = () => {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    const mode = connectionMode(access.agent(), connection.id)
    if (originalAgent !== access.agent()?.id || mode === 'off' || (mode === 'ask' && !asked))
      throw new Error('Connection access was revoked; approval is required.')
    if (connectionGeneration(connection.id) !== generation)
      throw new Error('The connection changed during this operation.')
  }
  const client = raw.guarded(assertAccess),
    repository = `${target.owner}/${target.repo}`,
    source = forgejoRepository(client, repository)
  source.assertCurrent()
  const json = (value: unknown) => {
    source.assertCurrent()
    return answer(
      `Git connection: ${connection.name} · ${connection.provider} · ${connection.server}\n\n${JSON.stringify(value, null, 2)}`
    )
  }
  const page = Math.max(1, whole(params.page, 1))
  const limit = Math.min(MAX_LINES, Math.max(1, whole(params.limit, DEFAULT_LINES)))
  const path = text(params.path)
  const at = async () => {
    if (text(params.ref)) return source.resolve(text(params.ref))
    if (target.kind === 'commit') return source.resolve(target.sha)
    if (target.kind === 'blob' || target.kind === 'tree') {
      const data = (await source.github.loadTarget(target, () => {})) as BlobData | FolderData
      return data.resolvedCommit ?? source.resolve(data.ref)
    }
    if (target.kind === 'pull' || target.kind === 'issue') {
      const data = (await source.github.loadTarget(
        target,
        () => {}
      )) as import('@/repository/conversation').PullData
      if (data.isPull || target.kind === 'pull') {
        if (!data.headSha)
          throw new Error('The service did not supply an immutable pull request head.')
        return data.headSha
      }
    }
    return source.resolve()
  }
  if (name === 'github_read') {
    if (!['issue', 'pull', 'discussion'].includes(target.kind))
      throw new Error('Name an issue or pull request.')
    const data = (await source.github.loadTarget(
      target,
      () => {}
    )) as import('@/repository/conversation').IssueData
    return json({
      ...data,
      comments: pageOf(data.comments, page),
      commentsComplete: data.commentsComplete,
    })
  }
  if (name === 'github_pr_files') {
    if (!('number' in target)) throw new Error('Name a pull request.')
    const data = await source.github.pullFiles(target.number)
    if (!path)
      return json({
        ...pageOf(data.files, page),
        complete: data.complete,
        reviewCommentsProblem: data.reviewCommentsProblem,
      })
    const matches = data.files.filter((f) => f.path === path || f.path.endsWith(`/${path}`))
    if (matches.length !== 1) throw new Error('Choose an exact or unique changed-file path.')
    const file = matches[0]
    await file.loadPatch?.()
    const offset = Math.max(1, whole(params.offset, 1)),
      lines = file.patch?.split('\n') ?? []
    return json({
      ...file,
      patch: lines
        .slice(offset - 1, offset - 1 + limit)
        .map((line, i) => `${offset + i}: ${line}`)
        .join('\n'),
      next: lines.length > offset - 1 + limit ? offset + limit : null,
    })
  }
  if (name === 'github_file') {
    const sha = await at()
    if (params.blame) return json(await source.blame(sha, path))
    if (params.recursive) {
      const tree = await source.tree(sha),
        files: { path: string; kind: string; size?: number }[] = []
      const walk = async (node: TreeNode) => {
        source.assertCurrent()
        if (files.length >= 100000) throw new Error('The recursive tree exceeds the tool limit.')
        if (node.kind === 'dir') {
          if (!node.children) await tree.expand(node)
          for (const child of node.children ?? []) await walk(child)
        } else if (!path || node.path === path || node.path.startsWith(`${path}/`))
          files.push({ path: node.path, kind: node.kind, size: node.size })
      }
      await walk(tree.root)
      return json({ revision: sha, ...pageOf(files, page, 100) })
    }
    const data =
      !path && (target.kind === 'blob' || target.kind === 'tree')
        ? await source.github.loadTarget(target, () => {})
        : await source.github.loadTarget(
            {
              ...target,
              kind: 'blob',
              refKind: 'commit',
              rest: [sha, ...path.split('/').filter(Boolean)],
            },
            () => {}
          )
    if (!('text' in data)) return json(data)
    const start = Math.max(1, whole(params.start_line, 1)),
      end = Math.min(
        start + MAX_LINES - 1,
        Math.max(start, whole(params.end_line, start + DEFAULT_LINES - 1))
      ),
      lines = data.text.split('\n')
    return json({
      ...data,
      text: lines
        .slice(start - 1, end)
        .map((line, i) => `${start + i}: ${line}`)
        .join('\n'),
      nextLine: lines.length > end ? end + 1 : null,
    })
  }
  if (name === 'github_commits') {
    const pull = whole(params.pull, target.kind === 'pull' ? target.number : 0)
    if (pull) {
      const data = await source.github.pullCommits(pull)
      return json({ ...pageOf(data.commits, page), complete: data.complete })
    }
    if (text(params.sha) || target.kind === 'commit') {
      const data = await source.commit(
        text(params.sha) || (target as Extract<GithubTarget, { kind: 'commit' }>).sha
      )
      if (path) {
        const file = data.files.find((file) => file.path === path)
        if (!file) throw new Error('That file is not in the commit.')
        await file.loadPatch?.()
        const offset = Math.max(1, whole(params.offset, 1)),
          lines = file.patch?.split('\n') ?? []
        return json({
          ...file,
          patch: lines.slice(offset - 1, offset - 1 + limit).join('\n'),
          next: lines.length > offset - 1 + limit ? offset + limit : null,
        })
      }
      return json(data)
    }
    if (text(params.head) || target.kind === 'compare')
      return json(
        await source.compare(
          text(params.base) || (target.kind === 'compare' ? target.base : undefined),
          text(params.head) || (target as Extract<GithubTarget, { kind: 'compare' }>).head
        )
      )
    return json({
      ...pageOf(await source.commits(await at(), path), page),
      note: 'Repository history is a bounded 100-commit window.',
    })
  }
  if (name === 'github_grep' || (name === 'github_search' && params.type === 'code')) {
    const revision = await at()
    const result = await source.search({
      ref: revision,
      scope: params.mode === 'names' ? 'names' : 'repo',
      query: {
        text: text(params.query),
        regex: params.regex === true,
        caseSensitive: params.case_sensitive === true,
      },
      glob: path,
      limitBytes: githubSettings().searchLimitMb * 1024 * 1024,
      signal,
    })
    const offset = Math.max(0, whole(params.offset, 0)),
      size = Math.min(100, Math.max(1, whole(params.limit, 50)))
    const hits = result.files.flatMap((file) =>
      file.lines.length
        ? file.lines.map((line) => ({ path: file.path, ...line }))
        : [{ path: file.path, url: file.url }]
    )
    return json({
      revision,
      total: result.total,
      capped: result.capped,
      note: result.note,
      hits: hits.slice(offset, offset + size),
      nextOffset: hits.length > offset + size ? offset + size : null,
    })
  }
  if (name === 'github_search') {
    const query = text(params.query),
      pull = /\bis:pr\b/.test(query)
    const listTarget = {
      ...target,
      kind: 'list' as const,
      list: pull ? ('pulls' as const) : ('issues' as const),
      query,
    }
    const read = async (list: 'issues' | 'pulls') => {
      const wanted = { ...listTarget, list }
      const data = (await source.github.loadTarget(wanted, () => {})) as ListData
      return page === 1 ? data : await source.github.listMore(wanted, page)
    }
    if (pull || /\bis:issue\b/.test(query)) return json(await read(pull ? 'pulls' : 'issues'))
    const [issues, pulls] = await Promise.all([read('issues'), read('pulls')])
    return json({
      issues,
      pulls,
      note: 'Issues and pull requests are paged separately with the same page number; no global rank is claimed.',
    })
  }
  if (name === 'github_open') {
    let url = input.startsWith('http')
      ? input
      : target.kind === 'issue'
        ? `${urls.repository(repository)}/issues/${target.number}`
        : urls.repository(repository)
    if (params.start_line !== undefined) {
      if (target.kind !== 'blob' && !path) throw new Error('Choose a file for a line selection.')
      if (target.kind === 'pull' || target.kind === 'commit' || target.kind === 'compare')
        throw new Error(
          'Precise diff selections are not available for this service. Open the change without a selection.'
        )
      const data =
        target.kind === 'blob'
          ? ((await source.github.loadTarget(target, () => {})) as BlobData)
          : null
      const from = Math.max(1, whole(params.start_line, 1)),
        to = Math.max(from, whole(params.end_line, from))
      url = urls.file(repository, await at(), path || data?.path, { from, to })
    }
    const allowedIds = rows
      .filter(
        (row) => connectionMode(access.agent(), row.id) === 'auto' || row.id === connection.id
      )
      .map((row) => row.id)
    const opened = await openGithubUrl(
      GlobalStore.getInstance().app,
      url,
      params.new_tab === true ? 'tab' : false,
      {
        connectionId: connection.id,
        manual: !!selected,
        allowedIds,
        agentId: originalAgent,
        approvedConnections: asked ? { [connection.id]: generation } : {},
      }
    )
    source.assertCurrent()
    if (!opened) throw new Error('No repository tab can show that URL.')
    return answer(`Shown in a repository tab: ${url}`)
  }
  throw new Error('This operation is not available for this service.')
}
