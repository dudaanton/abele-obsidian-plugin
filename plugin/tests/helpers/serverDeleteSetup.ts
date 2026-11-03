import { AccessClient } from '@abele/sync-sdk/core'
import { rawManifest } from './rawManifest'

/** Real server setup shared by deletion screenshots and their fast integration proof. */
export async function issueDeletionDevice(
  encoded: string,
  label: string,
  readOnly: boolean,
  transport: typeof fetch
) {
  const client = AccessClient.fromToken(encoded, { fetch: transport })
  const { kind, id } = (await client.connection()).scope
  return client.issue({ scope: { kind, id }, label, read_only: readOnly })
}

export async function deletionFolder(encoded: string, path: string, transport: typeof fetch) {
  return (await rawManifest(encoded, transport)).find(
    (one) => one.kind === 'directory' && one.path === path
  )
}
