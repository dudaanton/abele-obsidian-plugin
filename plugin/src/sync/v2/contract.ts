export {
  V2_PROTOCOL_VERSION,
  V2SelectorSchema,
  V2ScopeSchema,
  V2AccessTokenSchema,
  encodeAccessToken,
  V2ConnectionSchema,
  V2IssueTokenRequestSchema,
  V2TokenInfoSchema,
  V2IssueTokenResponseSchema,
  V2TokensResponseSchema,
  V2RevokeTokenResponseSchema,
  V2ManifestItemSchema,
  V2ManifestSchema,
  V2ChangeSchema,
  V2ChangesSchema,
  V2EventSchema,
  V2CommitOpSchema,
  V2CommitRequestSchema,
  V2CommitResponseSchema,
} from '@abele/sync-sdk/protocol'
export type {
  V2Selector,
  V2Scope,
  V2AccessToken,
  V2Connection,
  V2IssueTokenRequest,
  V2TokenInfo,
  V2IssueTokenResponse,
  V2ManifestItem,
  V2Manifest,
  V2Change,
  V2Changes,
  V2Event,
  V2CommitOp,
  V2CommitRequest,
  V2CommitResponse,
} from '@abele/sync-sdk/protocol'

import { decodeAccessToken as decodeSharedAccessToken } from '@abele/sync-sdk/protocol'
import type { V2AccessToken } from '@abele/sync-sdk/protocol'

/** Preserve pasted token normalization before the shared decoder's length check. */
export function decodeAccessToken(text: string): V2AccessToken {
  return decodeSharedAccessToken(text.replace(/[\s\u200b]/g, ''))
}
