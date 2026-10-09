import { loadItem } from '@/github/loadItem'
import type { GithubClient } from '@/github/client'
import { commitSha, loadBlob, loadCommit, restCommit } from '@/github/api'
import { repoApiPath } from '@/github/contents'
import { repoWeb } from '@/github/origin'
import { loadBlame } from '@/github/blame'
import { compareUrl, loadCompare } from '@/github/compare'
import { comparisonService } from '@/github/comparison/service'
import { repoTree } from '@/github/tree/repoTree'
import { blobUrlAt, treeUrl } from '@/github/tree/fileTree'
import { loadFolder } from '@/github/tree/folder'
import { blobLink, fileUrl } from '@/github/permalinks'
import {
  loadRepoHome,
  loadRefs,
  refsStarting,
  loadLanguages,
  loadOpenIssues,
  loadOpenPulls,
  loadLatestRelease,
  repoMeta,
  homeUrl,
  type RepoLike,
} from '@/github/repoPage/repoHome'
import { defaultBranch, resolveSha, repoIndex } from '@/github/search/source'
import { TabCode } from '@/github/search/tabCode'
import { findDefinitions } from '@/github/search/definitions'
import type { RepositorySource, RepositorySearch } from './source'

/** Wrap the exact operation client, including chat guards, never its underlying client. */
export function githubRepositorySource(
  client: GithubClient,
  repo: RepoLike,
  connection = ''
): RepositorySource {
  const service = () => comparisonService(client, repo)
  const base = { ...repo }
  return {
    identity: {
      provider: 'github',
      connection,
      server: repo.origin ?? `https://${repo.host}`,
      repository: `${repo.owner}/${repo.repo}`,
    },
    cacheNamespace: client.cacheNamespace,
    get isCurrent() {
      return client.isCurrent !== false
    },
    assertCurrent: () => client.assertCurrent?.(),
    navigation: {
      home: (ref, branch) => homeUrl(base, ref, branch),
      file: (ref, path, line) =>
        line === undefined ? blobUrlAt(base, ref, path) : fileUrl(base, ref, path, line),
      folder: (ref, path) => treeUrl(base, ref, path),
      commit: (sha) => `${repoWeb(base)}/commit/${sha}`,
      comparison: (from, to, direct) => compareUrl(base, from, to, direct),
      blobLink: (sha, path, lines) => blobLink(base, sha, path, lines),
    },
    github: {
      loadTarget: (target, promote, pinned) => loadItem(client, target, promote, pinned),
      listUrl: (kind) => `${repoWeb(base)}/${kind}`,
      languages: () => loadLanguages(client, base),
      issues: () => loadOpenIssues(client, base),
      pulls: () => loadOpenPulls(client, base),
      release: () => loadLatestRelease(client, base),
    },
    metadata: async () =>
      repoMeta(await client.get(repoApiPath(base), { what: `${base.owner}/${base.repo}` }), base),
    home: (ref) => loadRepoHome(client, { ...base, kind: 'repo', ref }),
    workspaces: async () => {
      client.assertCurrent?.()
      return []
    },
    refs: (prefix) => (prefix ? refsStarting(client, base, prefix) : loadRefs(client, base)),
    defaultBranch: () => defaultBranch(client, base),
    resolve: async (ref, verify) => {
      if (verify && ref && /^[a-f\d]{40}$/i.test(ref))
        return (
          await client.get<{ sha: string }>(
            `${repoApiPath(base)}/commits/${encodeURIComponent(ref)}`,
            { what: 'the comparison base commit' }
          )
        ).sha
      return ref ? commitSha(client, base, ref) : resolveSha(client, base)
    },
    tree: (sha) => repoTree(client, base, sha),
    folder: (ref, path) =>
      loadFolder(client, { ...base, kind: 'tree', rest: path ? [ref, path] : [ref] }),
    blob: (ref, path) => loadBlob(client, { ...base, kind: 'blob', rest: [ref, path] }),
    text: (ref, path, what) => client.fileText(base, path, ref, what),
    status: async () => {
      client.assertCurrent?.()
      return { supported: false, files: [] }
    },
    compare: (from, to, direct = false) =>
      loadCompare(client, { ...base, kind: 'compare', base: from, head: to, direct }),
    comparison: (from, to, signal) => service().index(from, to, signal),
    comparisonFile: (index, path, large = false, signal) =>
      service().file(index, path, large, signal),
    commit: (sha) => loadCommit(client, { ...base, kind: 'commit', sha }),
    commits: async (ref, path) => {
      const query = `sha=${encodeURIComponent(ref)}${path ? `&path=${encodeURIComponent(path)}` : ''}&per_page=100`
      const rows = await client.get<Parameters<typeof restCommit>[0][]>(
        `${repoApiPath(base)}/commits?${query}`,
        { what: 'the repository commits' }
      )
      return rows.map(restCommit)
    },
    blame: (ref, path) => loadBlame(client, { ...base, ref, path }),
    search: (request: RepositorySearch) =>
      new TabCode({
        client: () => client,
        repo: () => base,
        refLabel: () => request.ref,
        sha: async () => request.ref,
        changes: async () => request.changes ?? null,
        blob: () => null,
        open: () => {},
        pick: () => {},
        showReferences: () => {},
        limitBytes: () => request.limitBytes,
      }).search(request.scope, request.query, request.glob, request.onStage, request.signal),
    definitions: async (ref, name, fromPath, limitBytes, onStage) =>
      findDefinitions(
        (await repoIndex(client, base, ref, { limitBytes, onStage })).files,
        name,
        fromPath
      ),
    subscribe: (listener) => client.onRetire?.(() => listener({ kind: 'authority' })) ?? (() => {}),
  }
}
