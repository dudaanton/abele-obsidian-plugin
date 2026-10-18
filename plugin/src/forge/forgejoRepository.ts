import {
  uiJoin,
  type UiMessage,
  uiField,
  uiFieldMessage,
  uiFields,
  uiMessage,
  UiError,
} from '@/i18n/streamBErrors'

import type { RepositorySource, RepositoryTree } from '@/repository/source'
import type { BlobData, FolderData, RepoMeta, TreeNode, CommitSummary } from '@/repository/model'
import type {
  IssueData,
  PullData,
  FilesData,
  Conversation,
  Comment,
  DiffFile,
} from '@/repository/conversation'
import type { GithubTarget } from '@/github/urls'
import {
  buildTree,
  childrenFrom,
  ancestors,
  findNode,
  type TreeEntry,
} from '@/github/tree/fileTree'
import { forgejoPatch } from './forgejoDiff'
import { forgejoComparison } from './forgejoComparison'
import { forgejoSearch } from './forgejoSearch'
import { forgejoLists } from './forgejoLists'
import { nativeWrites } from './forgejoWrites'
import { forgejoUrls } from './forgejoUrls'
import { ForgejoError, type ForgejoClient } from './forgejoClient'
import { languageShares, type ItemRow, type ReleaseData } from '@/github/repoPage/repoHome'

interface RawRepo {
  name: string
  owner: { login: string }
  description?: string
  website?: string
  stars_count?: number
  forks_count?: number
  watchers_count?: number
  default_branch: string
  private?: boolean
  archived?: boolean
  empty?: boolean
  has_issues?: boolean
}
interface RawContent {
  name: string
  path: string
  type: string
  size?: number
  sha?: string
  encoding?: string
  content?: string
}
interface RawIssue {
  number: number
  title: string
  body?: string
  state: string
  merged?: boolean
  created_at: string
  user?: { login: string; avatar_url?: string } | null
  labels?: { name: string; color?: string }[]
  pull_request?: unknown
  base?: { ref: string; sha: string }
  head?: { ref: string; sha: string }
  comments?: number
}
interface RawComment {
  id: number
  body?: string
  created_at: string
  user?: { login: string } | null
  html_url?: string
}
interface RawCommit {
  sha: string
  commit: { message: string; author: { name: string; date: string } }
  author?: { login: string } | null
}
const commitSummary = (row: RawCommit): CommitSummary => ({
  sha: row.sha,
  message: row.commit.message,
  author: row.author?.login ?? row.commit.author.name,
  login: row.author?.login,
  date: row.commit.author.date,
})
interface RawFile {
  filename: string
  previous_filename?: string
  status: string
  additions?: number
  deletions?: number
}
export function forgejoRepository(client: ForgejoClient, repository: string): RepositorySource {
  const urls = forgejoUrls(client.deployment)
  const web = urls.repository(repository)
  const api = `/repos/${repository.split('/').map(encodeURIComponent).join('/')}`
  const comparisons = forgejoComparison(client, api, () => source)
  const code = forgejoSearch(client, api, () => source)
  const lists = forgejoLists(client, api, web)
  const people = new Map<string, Promise<import('@/repository/model').RepositoryPerson>>()
  const unavailable = async (): Promise<never> => {
    throw new UiError(uiMessage('streamBError.1209bb12ff'))
  }
  const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')
  const rawMeta = () => client.get<RawRepo>(api)
  const commentUrl = (address: string | undefined, number: number, pull: boolean): string => {
    const fallback = `${web}/${pull ? 'pulls' : 'issues'}/${number}`
    if (!address) return fallback
    try {
      const url = new URL(address),
        item = new URL(fallback)
      if (
        url.username ||
        url.password ||
        url.origin !== item.origin ||
        !(url.pathname === item.pathname || url.pathname.startsWith(`${item.pathname}/`)) ||
        [...url.searchParams.keys()].some((key) => /token|authorization|password/i.test(key))
      )
        return fallback
      return url.href
    } catch {
      return fallback
    }
  }
  const refKinds = new Map<string, 'branch' | 'tag' | 'commit'>()
  const fileUrl = (ref: string, path: string, lines?: { from: number; to: number }) =>
    urls.file(
      repository,
      ref,
      path,
      lines,
      /^[a-f\d]{40}$/i.test(ref) ? 'commit' : refKinds.get(ref)
    )
  const resolve = async (
    ref?: string,
    verify = false,
    kind?: 'branch' | 'tag' | 'commit'
  ): Promise<string> => {
    client.session.assertCurrent()
    if (ref && /^[a-f\d]{40}$/i.test(ref) && !verify && kind !== 'branch' && kind !== 'tag')
      return ref
    const at = ref ?? (await source.defaultBranch())
    const qualified =
      kind === 'branch' ? `refs/heads/${at}` : kind === 'tag' ? `refs/tags/${at}` : at
    const sha = (
      await client.get<{ sha: string }>(`${api}/commits/${encodeURIComponent(qualified)}`)
    ).sha
    if (!/^[a-f\d]{40}$/i.test(sha)) throw new UiError(uiMessage('streamBError.d4d581aba2'))
    return sha
  }
  const items = async (pull: boolean): Promise<ItemRow[]> => {
    const path = pull
      ? `${api}/pulls?state=open&sort=recentupdate&limit=5&page=1`
      : `${api}/issues?state=open&type=issues&sort=recentupdate&limit=5&page=1`
    const rows = await client.get<RawIssue[]>(path)
    return rows.slice(0, 5).map((row) => ({
      number: row.number,
      title: row.title,
      author: row.user?.login ?? 'ghost',
      createdAt: row.created_at ?? '',
      draft: false,
      comments: row.comments ?? 0,
      url: `${web}/${pull ? 'pulls' : 'issues'}/${row.number}`,
    }))
  }
  const pullFiles = async (number: number): Promise<FilesData> => {
    const result = await client.pages<RawFile>(`${api}/pulls/${number}/files`)
    let patches: Promise<string> | undefined
    let reviewCommentsProblem: string | undefined
    const comments = new Map<string, Comment[]>()
    try {
      const reviews = await client.pages<{ id: number }>(`${api}/pulls/${number}/reviews`)
      if (!reviews.complete) reviewCommentsProblem = 'Not all reviews could be listed.'
      for (const review of reviews.value) {
        const rows = await client.pages<
          RawComment & { path: string; old_line_num?: number; new_line_num?: number }
        >(`${api}/pulls/${number}/reviews/${review.id}/comments`)
        if (!rows.complete) reviewCommentsProblem = 'Not all inline comments could be listed.'
        for (const row of rows.value) {
          const line = row.new_line_num || row.old_line_num
          const list = comments.get(row.path) ?? []
          list.push({
            id: `inline-${row.id}`,
            body: row.body ?? '',
            author: row.user?.login ?? 'ghost',
            createdAt: row.created_at,
            location: `${row.path}${line ? `:${line}` : ''}`,
            url: commentUrl(row.html_url, number, true),
          })
          comments.set(row.path, list)
        }
      }
    } catch {
      client.session.assertCurrent()
      reviewCommentsProblem = 'The inline review comments could not be read from this service.'
    }
    const data: FilesData = {
      complete: result.complete,
      reviewCommentsProblem,
      files: result.value.map((file) => {
        const shown: DiffFile = uiFields(
          {
            path: file.filename,
            previousPath: file.previous_filename,
            status:
              file.status === 'deleted'
                ? 'removed'
                : file.status === 'changed'
                  ? 'modified'
                  : file.status,
            additions: file.additions ?? 0,
            deletions: file.deletions ?? 0,
            countsPending: file.additions === undefined || file.deletions === undefined,
            hash: '',
            patch: undefined,
            reviewComments: comments.get(file.filename) ?? [],
            diffNote: 'This service returns a file summary without a patch.',
          },
          { diffNote: uiMessage('streamBError.921180cd63') }
        )
        shown.loadPatch = async () => {
          client.session.assertCurrent()
          patches ??= client.text(`${api}/pulls/${number}.diff`).catch((error) => {
            patches = undefined
            throw error
          })
          const diff = await patches
          client.session.assertCurrent()
          shown.patch = forgejoPatch(
            diff,
            file.filename,
            file.status === 'removed' || file.status === 'deleted'
          )
          shown.diffNote = shown.patch
            ? undefined
            : uiField(shown, 'diffNote', uiMessage('streamBError.ce4159a6ef'))
        }
        return shown
      }),
    }
    return data
  }
  const pullCommits = async (number: number) => {
    const result = await client.pages<RawCommit>(`${api}/pulls/${number}/commits`)
    const commits: CommitSummary[] = result.value.map((row) => ({
      sha: row.sha,
      message: row.commit.message,
      author: row.author?.login ?? row.commit.author.name,
      login: row.author?.login,
      date: row.commit.author.date,
    }))
    return { commits, complete: result.complete }
  }
  const commit: RepositorySource['commit'] = async (ref) => {
    const sha = await resolve(ref)
    const raw = await client.get<RawCommit & { parents?: { sha: string }[]; files?: RawFile[] }>(
      `${api}/git/commits/${encodeURIComponent(sha)}`
    )
    let patches: Promise<string> | undefined
    return {
      ...commitSummary(raw),
      parentSha: raw.parents?.[0]?.sha,
      url: `${web}/commit/${sha}`,
      files: (raw.files ?? []).map((file) => {
        const shown: DiffFile = {
          path: file.filename,
          previousPath: file.previous_filename,
          status:
            file.status === 'deleted'
              ? 'removed'
              : file.status === 'changed'
                ? 'modified'
                : file.status,
          additions: file.additions ?? 0,
          deletions: file.deletions ?? 0,
          countsPending: file.additions === undefined || file.deletions === undefined,
          hash: '',
          reviewComments: [],
        }
        shown.loadPatch = async () => {
          client.session.assertCurrent()
          patches ??= client
            .text(`${api}/git/commits/${encodeURIComponent(sha)}.diff`)
            .catch((error) => {
              patches = undefined
              throw error
            })
          const diff = await patches
          client.session.assertCurrent()
          shown.patch = forgejoPatch(diff, file.filename, shown.status === 'removed')
          shown.diffNote = shown.patch
            ? undefined
            : 'No text patch is available for this file (binary, empty, renamed, or truncated).'
        }
        return shown
      }),
    }
  }
  const mapMetadata = (raw: RawRepo): RepoMeta => {
    return {
      owner: raw.owner.login,
      name: raw.name,
      description: raw.description ?? '',
      homepage: raw.website ?? '',
      topics: [],
      stars: raw.stars_count ?? 0,
      forks: raw.forks_count ?? 0,
      watchers: raw.watchers_count ?? 0,
      defaultBranch: raw.default_branch,
      license: null,
      visibility: raw.private ? 'private' : 'public',
      archived: !!raw.archived,
      parent: null,
      hasIssues: raw.has_issues !== false,
      url: web,
    }
  }
  const metadata = async () => mapMetadata(await rawMeta())
  const contents = (ref: string, path: string) =>
    client.get<RawContent | RawContent[]>(
      `${api}/contents${path ? `/${encodePath(path)}` : ''}?ref=${encodeURIComponent(ref)}`
    )
  const folder = async (ref: string, path: string, knownCommit?: string): Promise<FolderData> => {
    const resolvedCommit = knownCommit ?? (await resolve(ref)),
      raw = await contents(resolvedCommit, path)
    if (!Array.isArray(raw)) throw new UiError(uiMessage('streamBError.f1fe763173'))
    return {
      ref,
      resolvedCommit,
      path,
      url: fileUrl(resolvedCommit, path),
      entries: raw.map((entry) => ({
        name: entry.name,
        path: entry.path,
        size: entry.size,
        kind:
          entry.type === 'dir'
            ? 'dir'
            : entry.type === 'submodule'
              ? 'submodule'
              : entry.type === 'symlink'
                ? 'symlink'
                : 'file',
      })),
    }
  }
  const blob = async (ref: string, path: string, knownCommit?: string): Promise<BlobData> => {
    const resolvedCommit = knownCommit ?? (await resolve(ref)),
      raw = await contents(resolvedCommit, path)
    if (Array.isArray(raw) || raw.type === 'dir')
      throw new UiError(uiMessage('streamBError.b305654ab9'))
    let noteMessage: UiMessage | undefined
    let text = '',
      note: string | undefined
    if (raw.type === 'symlink' || raw.type === 'submodule')
      note =
        ((noteMessage = uiMessage('streamBError.01fa8fb2a8')),
        'This entry is a link, not a regular file.')
    else if ((raw.size ?? 0) > 2 * 1024 * 1024)
      note =
        ((noteMessage = uiMessage('streamBError.af130c9cfc')), 'This file is too large to display.')
    else if (raw.encoding !== 'base64' || raw.content === undefined)
      note =
        ((noteMessage = uiMessage('streamBError.fe05b9bbe4')),
        'The service did not return the file contents.')
    else {
      const bytes = Uint8Array.from(atob(raw.content.replace(/\s/g, '')), (c) => c.charCodeAt(0))
      if (bytes.includes(0))
        note = ((noteMessage = uiMessage('streamBError.9ff28c9fad')), 'Binary file.')
      else {
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        } catch {
          note = ((noteMessage = uiMessage('streamBError.329a3b9f4a')), 'Binary or non-UTF-8 file.')
        }
      }
    }
    return uiFields(
      {
        ref,
        resolvedCommit,
        path,
        text,
        contentId: raw.sha,
        url: fileUrl(resolvedCommit, path),
        ...(note ? { note } : {}),
      },
      { note: noteMessage }
    )
  }
  const conversation = async (number: number, pull: boolean): Promise<Conversation> => {
    const comments: Comment[] = []
    let complete = true
    const problems: string[] = []
    const problemMessages: UiMessage[] = []
    try {
      const page = await client.pages<RawComment>(`${api}/issues/${number}/comments`)
      comments.push(
        ...page.value.map((row) => ({
          id: String(row.id),
          body: row.body ?? '',
          author: row.user?.login ?? 'ghost',
          createdAt: row.created_at,
          anchor: `issuecomment-${row.id}`,
          url: commentUrl(row.html_url, number, pull),
        }))
      )
      complete = page.complete
    } catch {
      client.session.assertCurrent()
      complete = false
      problemMessages.push(uiMessage('streamBError.f5b8b2ba78'))
      problems.push('The conversation could not be read from this service.')
    }
    if (pull) {
      try {
        const reviews = await client.pages<RawComment & { state: string; submitted_at?: string }>(
          `${api}/pulls/${number}/reviews`
        )
        complete &&= reviews.complete
        comments.push(
          ...reviews.value
            .filter((r) => r.state !== 'PENDING')
            .map((r) => ({
              id: `review-${r.id}`,
              body: r.body ?? '',
              author: r.user?.login ?? 'ghost',
              createdAt: r.submitted_at ?? r.created_at ?? '',
              badge: r.state.replace(/_/g, ' ').toLowerCase(),
              url: commentUrl(r.html_url, number, true),
            }))
        )
      } catch {
        client.session.assertCurrent()
        complete = false
        problemMessages.push(uiMessage('streamBError.9acce75256'))
        problems.push('The pull request reviews could not be read from this service.')
      }
    }
    return uiFields(
      {
        comments: comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        complete,
        problem: problems.join(' ') || undefined,
      },
      { problem: uiJoin(problemMessages, ' ') }
    )
  }
  const issue = async (number: number, pull: boolean): Promise<IssueData | PullData> => {
    const raw = await client.get<RawIssue>(`${api}/${pull ? 'pulls' : 'issues'}/${number}`)
    const talk = await conversation(number, pull)
    const { comments, complete, problem } = talk
    const result: IssueData = uiFields(
      {
        number: raw.number,
        title: raw.title,
        body: raw.body ?? '',
        state: raw.merged ? 'merged' : raw.state,
        createdAt: raw.created_at,
        author: raw.user?.login ?? 'ghost',
        labels: (raw.labels ?? []).map((l) => ({ name: l.name, color: l.color ?? '' })),
        url: `${web}/${pull ? 'pulls' : 'issues'}/${number}`,
        comments,
        commentsComplete: complete,
        commentsProblem: problem,
        isPull: !!raw.pull_request,
      },
      { commentsProblem: uiFieldMessage(talk, 'problem') }
    )
    if (!pull) return result
    return uiFields(
      {
        ...result,
        base: raw.base?.ref ?? '',
        head: raw.head?.ref ?? '',
        baseSha: raw.base?.sha,
        headSha: raw.head?.sha,
        additions: null,
        deletions: null,
        changedFiles: null,
        commitsCount: null,
      },
      {},
      result
    )
  }
  const tree = async (sha: string): Promise<RepositoryTree> => {
    const answer = await client.get<{ tree: TreeEntry[]; truncated?: boolean }>(
      `${api}/git/trees/${encodeURIComponent(sha)}?recursive=true`
    )
    let root: TreeNode
    if (answer.truncated) {
      const top = await client.get<{ tree: TreeEntry[]; truncated?: boolean }>(
        `${api}/git/trees/${encodeURIComponent(sha)}`
      )
      if (top.truncated) throw new UiError(uiMessage('streamBError.2f27e1a646'))
      root = { name: '', path: '', kind: 'dir', children: childrenFrom('', top.tree) }
    } else root = buildTree(answer.tree)
    const expand: RepositoryTree['expand'] = async (node) => {
      client.session.assertCurrent()
      if (node.kind !== 'dir' || node.children) return
      if (!node.sha) throw new UiError(uiMessage('streamBError.dae9ef12db'))
      const raw = await client.get<{ tree: TreeEntry[]; truncated?: boolean }>(
        `${api}/git/trees/${encodeURIComponent(node.sha)}`
      )
      if (raw.truncated) throw new UiError(uiMessage('streamBError.f308135e99'))
      node.children = childrenFrom(node.path, raw.tree)
    }
    return {
      root,
      sha,
      truncated: !!answer.truncated,
      expand,
      reveal: async (path) => {
        for (const ancestor of ancestors(path)) {
          const node = findNode(root, ancestor)
          if (node) await expand(node)
        }
      },
    }
  }
  const compare: RepositorySource['compare'] = async (base, head, direct = false) => {
    const from = await resolve(base),
      to = await resolve(head)
    const native = await client.get<{
      commits: RawCommit[]
      total_commits: number
      files?: RawFile[]
    }>(`${api}/compare/${from}...${to}`)
    const index = direct ? await comparisons.index(from, to) : undefined
    const files: DiffFile[] = index
      ? index.changes.map((change) => {
          const file: DiffFile = {
            path: change.path,
            previousPath: change.previousPath,
            status: change.status,
            hash: '',
            additions: 0,
            deletions: 0,
            countsPending: true,
            reviewComments: [],
          }
          file.loadPatch = async () => {
            const value = await comparisons.file(index, change.path)
            file.diffNote = value.note
            if (!value.text) return
            const before = value.text.lines.filter((line) =>
              ['ctx', 'del'].includes(line.type)
            ).length
            const after = value.text.lines.filter((line) =>
              ['ctx', 'add'].includes(line.type)
            ).length
            file.patch =
              `@@ -${before ? 1 : 0},${before} +${after ? 1 : 0},${after} @@\n` +
              value.text.lines
                .map(
                  (line) =>
                    `${line.type === 'add' ? '+' : line.type === 'del' ? '-' : line.type === 'note' ? '' : ' '}${line.text}`
                )
                .join('\n') +
              '\n'
            file.additions = value.text.additions
            file.deletions = value.text.deletions
            file.countsPending = false
          }
          return file
        })
      : (native.files ?? []).map(
          (file): DiffFile => ({
            path: file.filename,
            previousPath: file.previous_filename,
            status: file.status === 'deleted' ? 'removed' : file.status,
            additions: file.additions ?? 0,
            deletions: file.deletions ?? 0,
            countsPending: file.additions === undefined || file.deletions === undefined,
            hash: '',
            reviewComments: [],
            diffNote:
              'The native comparison does not include text patches. Pin an endpoint base to compare full file contents.',
          })
        )
    client.session.assertCurrent()
    return {
      base: from,
      head: to,
      direct,
      mode: direct ? 'endpoint' : 'merge-base',
      status: from === to ? 'identical' : '',
      aheadBy: null,
      behindBy: null,
      totalCommits: native.total_commits,
      commits: native.commits.map(commitSummary),
      commitsComplete: native.commits.length >= native.total_commits,
      files,
      filesComplete: !!index,
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0),
      headSha: to,
      mergeBaseSha: direct ? from : undefined,
      url: source.navigation.comparison(from, to, direct),
      note: direct
        ? undefined
        : 'Native comparison metadata; the service does not supply a verified merge-base SHA or text patches here. Pin an endpoint base for full file diffs.',
    }
  }
  const source: RepositorySource = {
    identity: {
      provider: client.deployment.kind === 'gitea' ? 'gitea' : 'forgejo',
      connection: client.session.connectionId,
      deployment: client.deployment,
      repository,
    },
    cacheNamespace: client.session.generation,
    get isCurrent() {
      try {
        client.session.assertCurrent()
        return true
      } catch {
        return false
      }
    },
    assertCurrent: () => client.session.assertCurrent(),
    navigation: {
      ref: (kind, ref) => urls.file(repository, ref, '', undefined, kind),
      home: (ref, branch) => (ref && ref !== branch ? fileUrl(ref, '') : web),
      file: (ref, path, line) => fileUrl(ref, path, line ? { from: line, to: line } : undefined),
      folder: (ref, path) => fileUrl(ref, path),
      commit: (sha) => `${web}/commit/${encodeURIComponent(sha)}`,
      comparison: (base, head, direct = false) =>
        `${web}/compare/${encodeURIComponent(base)}${direct ? '..' : '...'}${encodeURIComponent(head)}`,
      blobLink: (sha, path, lines) => ({
        label: `${repository}/${path}`,
        url: urls.file(repository, sha, path, lines),
      }),
    },
    metadata,
    home: async (ref) => {
      const raw = await rawMeta(),
        meta = mapMetadata(raw)
      const at = ref ?? meta.defaultBranch
      if (raw.empty && !ref) return { ref: at, path: '', entries: [], meta, empty: true, url: web }
      const sha = await resolve(at, false, ref ? refKinds.get(ref) : 'branch')
      return { ...(await folder(at, '', sha)), meta }
    },
    refs: async (prefix) => {
      const [branches, tags] = await Promise.all([
        client.pages<{ name: string }>(`${api}/branches`),
        client.pages<{ name: string }>(`${api}/tags`),
      ])
      const names = (rows: { name: string }[]) =>
        rows.map((row) => row.name).filter((name) => !prefix || name.startsWith(prefix))
      for (const branch of branches.value) refKinds.set(branch.name, 'branch')
      for (const tag of tags.value) if (!refKinds.has(tag.name)) refKinds.set(tag.name, 'tag')
      return {
        branches: names(branches.value),
        tags: names(tags.value),
        more: !branches.complete || !tags.complete,
      }
    },
    defaultBranch: async () => (await rawMeta()).default_branch,
    resolve,
    tree,
    folder: (ref, path) => folder(ref, path),
    blob: (ref, path) => blob(ref, path),
    text: async (ref, path) => {
      const data = await blob(ref, path)
      if (data.note) throw new UiError(uiFieldMessage(data, 'note'))
      return data.text
    },
    workspaces: async () => [],
    status: async () => ({ supported: false, files: [] }),
    compare,
    comparison: comparisons.index,
    comparisonFile: comparisons.file,
    commit,
    commits: async (ref, path) => {
      const sha = await resolve(ref)
      // The existing history view displays one bounded page; resolve aliases before reading it.
      const rows = await client.get<RawCommit[]>(
        `${api}/commits?sha=${encodeURIComponent(sha)}${path ? `&path=${encodeURIComponent(path)}` : ''}&limit=100&page=1`
      )
      return rows.map(commitSummary)
    },
    blame: unavailable,
    search: code.search,
    definitions: code.definitions,
    subscribe: () => () => {},
    github: {
      writes: nativeWrites(client, repository),
      person: async (login) => {
        client.session.assertCurrent()
        if (!/^[\w.-]{1,100}$/.test(login)) throw new Error('Invalid profile login.')
        let pending = people.get(login)
        if (pending === undefined) {
          pending = (async () => {
            const raw = await client.get<{
              login: string
              full_name?: string
              name?: string
              avatar_url?: string
            }>(`/users/${encodeURIComponent(login)}`)
            if (raw.login.toLowerCase() !== login.toLowerCase())
              throw new Error('The service returned a different profile.')
            const avatar = raw.avatar_url ? await client.avatar(raw.avatar_url) : null
            client.session.assertCurrent()
            return { login, name: raw.full_name || raw.name || null, avatar }
          })()
          people.set(login, pending)
          void pending.catch(() => {
            if (people.get(login) === pending) people.delete(login)
          })
          while (people.size > 32) people.delete(people.keys().next().value)
        }
        const person = await pending
        client.session.assertCurrent()
        return person
      },
      listMore: lists.more,
      listChoices: lists.choices,
      conversation,
      pullFiles,
      pullCommits,
      loadTarget: async (target: GithubTarget, promote, pinned = {}) => {
        if (
          `${target.owner}/${target.repo}` !== repository ||
          target.origin !== client.deployment.webBase
        )
          throw new UiError(uiMessage('streamBError.cd278c1617'))
        if (target.kind === 'repo') return source.home(target.ref)
        if (target.kind === 'issue') {
          const data = await issue(target.number, false)
          if (!data.isPull) return data
          promote({ ...target, kind: 'pull', tab: 'conversation' })
          return issue(target.number, true)
        }
        if (target.kind === 'pull') return issue(target.number, true)
        if (target.kind === 'commit') return commit(target.sha)
        if (target.kind === 'list') return lists.list(target)
        if (target.kind === 'compare') return compare(target.base, target.head, target.direct)
        if (target.kind === 'blob' || target.kind === 'tree') {
          let ref = '',
            path = '',
            sha = ''
          for (
            let split = target.refKind === 'commit' ? 1 : target.rest.length;
            split >= 1;
            split--
          ) {
            const candidate = target.rest.slice(0, split).join('/')
            try {
              sha = await resolve(candidate, false, target.refKind)
              ref = candidate
              path = target.rest.slice(split).join('/')
              break
            } catch (error) {
              if (!(error instanceof ForgejoError && error.status === 404)) throw error
            }
          }
          if (!ref) throw new UiError(uiMessage('streamBError.43d93bea97'))
          if (target.refKind) refKinds.set(ref, target.refKind)
          if (pinned.base && target.kind === 'blob') {
            const index = await comparisons.index(pinned.base.baseSha, sha, pinned.signal)
            const change = index.changes.find((c) => c.path === path || c.previousPath === path)
            await index.target.reveal(path)
            client.session.assertCurrent()
            if (change || findNode(index.target.root, path)?.kind === 'file') {
              const comparison = await comparisons.file(index, path, false, pinned.signal)
              return {
                ref: sha,
                resolvedCommit: sha,
                path: comparison.path,
                text: comparison.after?.text ?? '',
                url: fileUrl(sha, comparison.path),
                comparison,
              }
            }
          }
          const raw = await contents(sha, path)
          if (Array.isArray(raw)) {
            if (!path) {
              promote({
                provider: target.provider,
                kind: 'repo',
                host: target.host,
                origin: target.origin,
                owner: target.owner,
                repo: target.repo,
                ref,
                anchor: target.anchor,
              })
              return source.home(ref)
            }
            promote({ ...target, kind: 'tree' })
            return path ? folder(ref, path, sha) : source.home(ref)
          }
          promote({ ...target, kind: 'blob' })
          return blob(ref, path, sha)
        }
        return unavailable()
      },
      listUrl: (kind) => `${web}/${kind}`,
      languages: async () =>
        languageShares(await client.get<Record<string, number>>(`${api}/languages`)),
      issues: () => items(false),
      pulls: () => items(true),
      release: async (): Promise<ReleaseData | null> => {
        try {
          const raw = await client.get<{
            name?: string
            tag_name: string
            published_at?: string
            prerelease?: boolean
            author?: { login: string }
          }>(`${api}/releases/latest`)
          return {
            name: raw.name || raw.tag_name,
            tag: raw.tag_name,
            publishedAt: raw.published_at ?? '',
            prerelease: !!raw.prerelease,
            author: raw.author?.login ?? '',
            url: `${web}/releases/tag/${encodeURIComponent(raw.tag_name)}`,
          }
        } catch (error) {
          if (error instanceof ForgejoError && error.status === 404) return null
          throw error
        }
      },
    },
  }
  return source
}
