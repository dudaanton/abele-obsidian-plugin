/** Retained external recovery descriptors; no invitation or join workflow. */
export const SCOPED_JOIN_KEY = 'abele-sync-scoped-join'
export const SCOPED_CONNECTION_KEY = 'abele-sync-scoped-connection'
export interface ScopedLocalConnection {
  version: 4
  facet: 'scoped'
  issuer: string
  vaultId: string
  grantId: string
  memberId: string
  principalId: string
  principalKind: 'installation'
  role: 'reader' | 'editor'
  rootFileId: string
  tokenId: string
  ledgerId: string
  scriptPolicy: 'refuse'
}
