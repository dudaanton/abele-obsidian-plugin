import type { GithubClient } from './client'
import { GithubError } from './client'
import { targetKey, type GithubTarget } from './urls'
import { commitHistoryQuery, type CommitRequest } from './commitRequest'
import { withFallback } from './sections'
import { graphqlCommits } from './graphql'
import { repoApiPath } from './contents'
import { loadBlob, FolderError } from './api'
import { loadFolder, NotAFolderError } from './tree/folder'
import { loadCompare } from './compare'

export type GithubPrimaryTarget =
  | GithubTarget
  | (Pick<GithubTarget, 'host' | 'origin' | 'owner' | 'repo'> &
      Extract<CommitRequest, { kind: 'pull-commits' | 'commit-history' }>)

/** Refusal memory must distinguish commit-list access from readable PR/repository metadata. */
export function primaryAccessKey(target: GithubPrimaryTarget): string {
  if (target.kind === 'pull-commits')
    return `${targetKey({ ...target, kind: 'repo' })}:pull-commits:${target.number}`
  if (target.kind === 'commit-history')
    return `${targetKey({ ...target, kind: 'repo' })}:history:${JSON.stringify([target.ref, target.path, target.page])}`
  return targetKey(target)
}

/** Test the requested primary resource, never a comment/review/avatar or an optional release. */
export async function primaryAccess(
  client: GithubClient,
  target: GithubPrimaryTarget
): Promise<void> {
  const base = repoApiPath(target)
  const rest = async (path: string) => {
    const result = await client.probe(path)
    if (result.error) throw result.error
  }
  switch (target.kind) {
    case 'pull-commits':
      await withFallback<unknown>(
        client,
        () =>
          client.get(`${base}/pulls/${target.number}/commits?per_page=1`, {
            what: "the pull request's commits",
          }),
        () => graphqlCommits(client, target)
      )
      return
    case 'commit-history':
      return rest(`${base}/commits?${commitHistoryQuery(target, 1)}`)
    case 'issue': {
      const issue = await client.probe<{ pull_request?: unknown }>(
        `${base}/issues/${target.number}`
      )
      if (issue.error) throw issue.error
      // An issue URL can name a PR. Its metadata is still primary, not an optional review.
      if (issue.body?.pull_request) await rest(`${base}/pulls/${target.number}`)
      return
    }
    case 'pull':
      return rest(`${base}/pulls/${target.number}`)
    case 'commit':
      return rest(`${base}/commits/${encodeURIComponent(target.sha)}`)
    case 'repo':
      return rest(base)
    case 'list':
      if (target.list !== 'discussions') return rest(`${base}/issues?per_page=1`)
      await client.graphql(
        'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){discussions(first:1){totalCount}}}',
        { owner: target.owner, name: target.repo }
      )
      return
    case 'discussion': {
      const found = await client.graphql<{ repository?: { discussion?: { id: string } | null } }>(
        'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){discussion(number:$number){id}}}',
        { owner: target.owner, name: target.repo, number: target.number }
      )
      if (!found.repository?.discussion)
        throw new GithubError('not-found', 'The discussion was not found.', 404)
      return
    }
    // Ambiguous slashed refs need the same split logic as the item loader. A folder/file
    // promotion is proof of access to that resource, not an account refusal.
    case 'blob':
      try {
        await loadBlob(client, target)
      } catch (e) {
        if (!(e instanceof FolderError)) throw e
      }
      return
    case 'tree':
      try {
        await loadFolder(client, target)
      } catch (e) {
        if (!(e instanceof NotAFolderError)) throw e
      }
      return
    case 'compare':
      await loadCompare(client, target)
      return
  }
}
