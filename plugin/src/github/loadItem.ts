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

type Of<K extends GithubTarget['kind']> = Extract<GithubTarget, { kind: K }>

export type ItemData = IssueData | PullData | DiscussionData | CommitData | BlobData | FolderData

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
    case 'tree':
      try {
        return await loadFolder(client, t)
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
