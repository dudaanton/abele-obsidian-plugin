import type { RepositorySource } from '@/repository/source'
import type { Deployment, RepoId, Support } from './model'
import type { CredentialSession } from './transport'

export interface ForgeUrlCodec<Target> {
  parse(url: string): Target | null
  repository(repo: RepoId): string
}
export interface ForgeCapabilities {
  blame: Support
  discussions: Support
  serverCodeSearch: Support
  draftCreate: Support
  inboxRead: Support
  inboxDone: Support
}
/** Small repository capability. Conversation/search/inbox adapters extend it independently. */
export interface ForgeProvider<Target> {
  readonly deployment: Deployment
  readonly urls: ForgeUrlCodec<Target>
  readonly capabilities: ForgeCapabilities
  readonly session: CredentialSession
  repository(repo: RepoId): RepositorySource
}
