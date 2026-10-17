import type { RepositorySource, RepositoryTree } from '@/repository/source'
import type { BlobData, FolderData, RepoMeta, TreeNode, CommitSummary } from '@/repository/model'
import type { IssueData, FilesData } from '@/repository/conversation'
import type { GithubTarget } from '@/github/urls'
import {
  buildTree,
  childrenFrom,
  ancestors,
  findNode,
  type TreeEntry,
} from '@/github/tree/fileTree'
import { forgejoUrls } from './forgejoUrls'
import type { ForgejoClient } from './forgejoClient'

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
}
interface RawComment {
  id: number
  body?: string
  created_at: string
  user?: { login: string } | null
}
interface RawCommit {
  sha: string
  commit: { message: string; author: { name: string; date: string } }
  author?: { login: string } | null
}
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
  const unavailable = async (): Promise<never> => {
    throw new Error('Not available for this service in this version.')
  }
  const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')
  const rawMeta = () => client.get<RawRepo>(api)
  const pullFiles = async (number: number): Promise<FilesData> => {
    const result = await client.pages<RawFile>(`${api}/pulls/${number}/files`)
    return {
      complete: result.complete,
      files: result.value.map((file) => ({
        path: file.filename,
        previousPath: file.previous_filename,
        status: file.status,
        additions: file.additions ?? 0,
        deletions: file.deletions ?? 0,
        countsPending: file.additions === undefined || file.deletions === undefined,
        hash: '',
        patch: undefined,
        reviewComments: [],
        diffNote: 'This service returns a file summary without a patch.',
      })),
    }
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
  const metadata = async (): Promise<RepoMeta> => {
    const raw = await rawMeta()
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
  const contents = (ref: string, path: string) =>
    client.get<RawContent | RawContent[]>(
      `${api}/contents${path ? `/${encodePath(path)}` : ''}?ref=${encodeURIComponent(ref)}`
    )
  const folder = async (ref: string, path: string): Promise<FolderData> => {
    const raw = await contents(ref, path)
    if (!Array.isArray(raw)) throw new Error('This path is a file.')
    return {
      ref,
      path,
      url: urls.file(repository, ref, path),
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
  const blob = async (ref: string, path: string): Promise<BlobData> => {
    const raw = await contents(ref, path)
    if (Array.isArray(raw) || raw.type === 'dir') throw new Error('This path is a folder.')
    let text = '',
      note: string | undefined
    if (raw.type === 'symlink' || raw.type === 'submodule')
      note = 'This entry is a link, not a regular file.'
    else if ((raw.size ?? 0) > 2 * 1024 * 1024) note = 'This file is too large to display.'
    else if (raw.encoding !== 'base64' || raw.content === undefined)
      note = 'The service did not return the file contents.'
    else {
      const bytes = Uint8Array.from(atob(raw.content.replace(/\s/g, '')), (c) => c.charCodeAt(0))
      if (bytes.includes(0)) note = 'Binary file.'
      else text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    }
    return {
      ref,
      path,
      text,
      contentId: raw.sha,
      url: urls.file(repository, ref, path),
      ...(note ? { note } : {}),
    }
  }
  const issue = async (number: number, pull: boolean): Promise<IssueData> => {
    // The shared PR view requires known aggregate counts. Do not fabricate them from absent fields.
    if (pull) return unavailable()
    const raw = await client.get<RawIssue>(`${api}/${pull ? 'pulls' : 'issues'}/${number}`)
    let comments: IssueData['comments'] = [],
      complete = false,
      problem: string | undefined
    try {
      const page = await client.pages<RawComment>(`${api}/issues/${number}/comments`)
      comments = page.value.map((row) => ({
        id: String(row.id),
        body: row.body ?? '',
        author: row.user?.login ?? 'ghost',
        createdAt: row.created_at,
        anchor: `issuecomment-${row.id}`,
        url: `${web}/${pull ? 'pulls' : 'issues'}/${number}#issuecomment-${row.id}`,
      }))
      complete = page.complete
    } catch {
      client.session.assertCurrent()
      problem = 'The conversation could not be read from this service.'
    }
    const result: IssueData = {
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
    }
    return result
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
      if (top.truncated) throw new Error('The service did not return a complete root tree.')
      root = { name: '', path: '', kind: 'dir', children: childrenFrom('', top.tree) }
    } else root = buildTree(answer.tree)
    const expand: RepositoryTree['expand'] = async (node) => {
      client.session.assertCurrent()
      if (node.kind !== 'dir' || node.children) return
      if (!node.sha) throw new Error('The service did not return the folder tree identity.')
      const raw = await client.get<{ tree: TreeEntry[]; truncated?: boolean }>(
        `${api}/git/trees/${encodeURIComponent(node.sha)}`
      )
      if (raw.truncated) throw new Error('The service did not return a complete folder tree.')
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
  const source: RepositorySource = {
    identity: {
      provider: 'forgejo',
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
      home: (ref, branch) => (ref && ref !== branch ? urls.file(repository, ref, '') : web),
      file: (ref, path, line) =>
        urls.file(repository, ref, path, line ? { from: line, to: line } : undefined),
      folder: (ref, path) => urls.file(repository, ref, path),
      commit: (sha) => `${web}/commit/${encodeURIComponent(sha)}`,
      comparison: () => web,
      blobLink: (sha, path, lines) => ({
        label: `${repository}/${path}`,
        url: urls.file(repository, sha, path, lines),
      }),
    },
    metadata,
    home: async (ref) => {
      const meta = await metadata()
      const at = ref ?? meta.defaultBranch
      return { ...(await folder(at, '')), meta }
    },
    refs: async (prefix) => {
      const [branches, tags] = await Promise.all([
        client.pages<{ name: string }>(`${api}/branches`),
        client.pages<{ name: string }>(`${api}/tags`),
      ])
      const names = (rows: { name: string }[]) =>
        rows.map((row) => row.name).filter((name) => !prefix || name.startsWith(prefix))
      return {
        branches: names(branches.value),
        tags: names(tags.value),
        more: !branches.complete || !tags.complete,
      }
    },
    defaultBranch: async () => (await rawMeta()).default_branch,
    resolve: async (ref) =>
      (
        await client.get<{ sha: string }>(
          `${api}/git/commits/${encodeURIComponent(ref ?? (await source.defaultBranch()))}`
        )
      ).sha,
    tree,
    folder,
    blob,
    text: async (ref, path) => {
      const data = await blob(ref, path)
      if (data.note) throw new Error(data.note)
      return data.text
    },
    workspaces: async () => [],
    status: async () => ({ supported: false, files: [] }),
    compare: unavailable,
    comparison: unavailable,
    comparisonFile: unavailable,
    commit: unavailable,
    commits: unavailable,
    blame: unavailable,
    search: unavailable,
    definitions: unavailable,
    subscribe: () => () => {},
    github: {
      pullFiles,
      pullCommits,
      loadTarget: async (target: GithubTarget, promote) => {
        if (
          `${target.owner}/${target.repo}` !== repository ||
          target.origin !== client.deployment.webBase
        )
          throw new Error('This target belongs to another repository or deployment.')
        if (target.kind === 'repo') return source.home(target.ref)
        if (target.kind === 'issue') return issue(target.number, false)
        if (target.kind === 'pull') return issue(target.number, true)
        if (target.kind === 'blob' || target.kind === 'tree') {
          const [ref, ...parts] = target.rest,
            path = parts.join('/')
          const raw = await contents(ref, path)
          if (Array.isArray(raw)) {
            promote({ ...target, kind: 'tree' })
            return path ? folder(ref, path) : source.home(ref)
          }
          promote({ ...target, kind: 'blob' })
          return blob(ref, path)
        }
        return unavailable()
      },
      listUrl: (kind) => `${web}/${kind}`,
      languages: unavailable,
      issues: unavailable,
      pulls: unavailable,
      release: unavailable,
    },
  }
  return source
}
