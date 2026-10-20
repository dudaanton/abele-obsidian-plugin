import type { V2ManifestItem, V2CommitOp } from '../../../src/sync/v2/contract'
import { waitFor } from './syncVault'
import { rawManifest } from '../../helpers/rawManifest'

interface FolderFixture {
  commit(ops: V2CommitOp[]): Promise<void>
  server: { rootToken: string }
}

export async function createServerFolder(
  fixture: FolderFixture,
  path: string,
  transport: typeof fetch = globalThis.fetch
): Promise<V2ManifestItem> {
  await fixture.commit([{ op: 'mkdir', path }])
  let directory: V2ManifestItem | undefined
  await waitFor(
    'explicit folder identity in server inventory',
    async () => {
      directory = (await rawManifest(fixture.server.rootToken, transport)).find(
        (item) => item.kind === 'directory' && item.path === path
      )
      return directory !== undefined
    },
    90000
  )
  if (!directory) throw new Error('Folder inventory completed without a directory identity')
  return directory
}
