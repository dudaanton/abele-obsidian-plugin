import type { GithubClient } from './client'
import { GithubError } from './client'
import type { GithubTarget } from './urls'
import { repoApiPath } from './contents'
import { loadBlob, FolderError } from './api'
import { loadFolder, NotAFolderError } from './tree/folder'
import { loadCompare } from './compare'

/** Test the requested primary resource, never a comment/review/avatar or an optional release. */
export async function primaryAccess(client: GithubClient, target: GithubTarget): Promise<void> {
  const base = repoApiPath(target)
  const rest = async (path: string) => {
    const result = await client.probe(path)
    if (result.error) throw result.error
  }
  switch (target.kind) {
    case 'issue':
      return rest(`${base}/issues/${target.number}`)
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
