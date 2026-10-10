import { sha256 } from '@abele/sync-core'
import type { TokenConnectionRecord } from './tokenConnectionRegistry'
import type { ConnectionBinding } from './external/records'
/** Opaque token identity and a device-local slot fingerprint; never a legacy grant. */
export async function tokenExternalBinding(
  record: TokenConnectionRecord,
  key: string
): Promise<ConnectionBinding> {
  return {
    endpoint: record.address,
    vaultId: record.spaceId,
    mode: 'token',
    principalId: record.tokenId,
    principalType: 'token',
    grantId: null,
    generation: 1,
    credentialAssociation: await sha256(
      new TextEncoder().encode(JSON.stringify([record.id, record.secretReference, key]))
    ),
  }
}
