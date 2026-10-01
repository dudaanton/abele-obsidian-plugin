/**
 * What a GitHub tab loads for a link. Mostly the thing the link names; where GitHub itself would
 * redirect, the thing it redirects to — an issue number that is a pull request, a file link that
 * names a folder and a folder link that names a file — reported through `promote` so the tab
 * shows it as what it is.
 */
import type { GithubClient } from './client'
import type { GithubTarget } from './urls'
import { repoWeb } from './origin'
import {
  FolderError,
  loadBlob,
  loadCommit,
  loadDiscussion,
  loadIssue,
  loadPull,
  type BlobData,
  type CommitData,
  type DiscussionData,
  type IssueData,
  type PullData,
} from './api'
import { NotAFolderError, loadFolder, type FolderData } from './tree/folder'
import { loadCompare, type CompareData } from './compare'
import { loadRepoHome, type RepoHomeData } from './repoPage/repoHome'
import { loadList, type ListData } from './lists/listData'

type Of<K extends GithubTarget['kind']> = Extract<GithubTarget, { kind: K }>

export type ItemData =
  | IssueData
  | PullData
  | DiscussionData
  | CommitData
  | BlobData
  | FolderData
  | CompareData
  | RepoHomeData
  | ListData

export async function loadItem(
  client: GithubClient,
  t: GithubTarget,
  promote: (shown: GithubTarget) => void
): Promise<ItemData> {
  switch (t.kind) {
    case 'issue': {
      const issue = await loadIssue(client, t)
      if (!issue.isPull) return issue
      const pull: Of<'pull'> = { ...t, kind: 'pull', tab: 'conversation' }
      promote(pull)
      return loadPull(client, pull)
    }
    case 'pull':
      return loadPull(client, t)
    case 'discussion':
      return loadDiscussion(client, t)
    case 'commit':
      return loadCommit(client, t)
    case 'compare':
      return loadCompare(client, t)
    case 'blob':
      try {
        return await loadBlob(client, t)
      } catch (e) {
        // A folder's link written as a file's — a README's `packages/core`: its listing.
        if (!(e instanceof FolderError)) throw e
        const tree: Of<'tree'> = { ...t, kind: 'tree', rest: [e.ref, e.path] }
        promote(tree)
        return loadFolder(client, tree)
      }
    case 'repo':
      return loadRepoHome(client, t)
    case 'list':
      return loadList(client, t)
    case 'tree':
      try {
        const folder = await loadFolder(client, t)
        if (folder.path) return folder
        // The root at a ref is the front page at that ref, as the branch switcher opens it.
        const { host, origin, owner, repo, anchor } = t
        const home: Of<'repo'> = { kind: 'repo', host, origin, owner, repo, anchor, ref: folder.ref }
        promote(home)
        return await loadRepoHome(client, home, folder)
      } catch (e) {
        // And a file's link written as a folder's: the file.
        if (!(e instanceof NotAFolderError)) throw e
        promote({ ...t, kind: 'blob', rest: [e.ref, e.path] })
        return {
          ref: e.ref,
          path: e.path,
          text: await client.fileText(t, e.path, e.ref),
          url: `${repoWeb(t)}/blob/${t.rest.map(encodeURIComponent).join('/')}`,
        }
      }
  }
}
