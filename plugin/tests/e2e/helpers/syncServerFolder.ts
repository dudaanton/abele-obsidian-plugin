import type { V2ManifestItem, V2CommitOp } from '../../../src/sync/v2/contract'
import { waitFor } from './syncVault'

interface FolderFixture {
  commit(ops: V2CommitOp[]): Promise<void>
  items(): Promise<V2ManifestItem[]>
}

export async function createServerFolder(
  fixture: FolderFixture,
  path: string
): Promise<V2ManifestItem> {
  await fixture.commit([{ op: 'mkdir', path }])
  let directory: V2ManifestItem | undefined
  await waitFor(
    'explicit folder identity in server inventory',
    async () => {
      directory = (await fixture.items()).find(
        (item) => item.kind === 'directory' && item.path === path
      )
      return directory !== undefined
    },
    90000
  )
  if (!directory) throw new Error('Folder inventory completed without a directory identity')
  return directory
}
