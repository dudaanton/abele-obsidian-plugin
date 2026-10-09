// Protocol source 10e8f23; local copy until the shared packages are vendored.
import { z } from 'zod'
import { normalizeServerUrl, serverUrlProblem } from '@abele/sync-protocol'
import {
  CommitOpSchema,
  CommitOpResultSchema,
  FileKindSchema,
  PathSchema,
  ShaSchema,
} from './fileSchemas'

export const V2_PROTOCOL_VERSION = 2
const id = z.string().min(1).max(200)
const integer = z.number().int().nonnegative().safe()
const timestamp = z.string().datetime({ offset: true })
export const V2SelectorSchema = z.object({ kind: z.enum(['folder', 'group']), id }).strict()
export type V2Selector = z.infer<typeof V2SelectorSchema>
export const V2ScopeSchema = V2SelectorSchema.extend({ path: PathSchema }).strict()
export type V2Scope = z.infer<typeof V2ScopeSchema>
export const V2AccessTokenSchema = z
  .object({
    v: z.literal(1),
    address: z
      .string()
      .max(2048)
      .superRefine((value, ctx) => {
        const problem = serverUrlProblem(value)
        if (problem !== null) ctx.addIssue({ code: 'custom', message: problem })
      })
      .transform((value) => normalizeServerUrl(value)!),
    key: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'token key must be a 256-bit base64url secret'),
    scope: V2ScopeSchema,
  })
  .strict()
export type V2AccessToken = z.infer<typeof V2AccessTokenSchema>

/** Portable to the plugin/mobile host; no Node Buffer dependency. QR carries this exact text. */
export function encodeAccessToken(value: V2AccessToken): string {
  const bytes = new TextEncoder().encode(JSON.stringify(V2AccessTokenSchema.parse(value)))
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
}
export function decodeAccessToken(text: string): V2AccessToken {
  try {
    const encoded = text.trim()
    if (
      encoded.length > 8192 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
    )
      throw new Error('invalid base64')
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return V2AccessTokenSchema.parse(JSON.parse(json))
  } catch (error) {
    throw new Error(
      `Invalid connection token: ${error instanceof Error ? error.message : 'invalid payload'}`
    )
  }
}

export const V2ConnectionSchema = z
  .object({
    protocol: z.literal(2),
    token_id: id,
    space_id: id,
    scope: V2ScopeSchema,
    status: z.enum(['active', 'scope_unavailable', 'scope_updating']),
    limits: z
      .object({ max_file_bytes: integer.positive(), quota_bytes: integer.nullable() })
      .strict(),
  })
  .strict()
export type V2Connection = z.infer<typeof V2ConnectionSchema>
export const V2IssueTokenRequestSchema = z
  .object({ scope: V2SelectorSchema, label: z.string().trim().min(1).max(200) })
  .strict()
export type V2IssueTokenRequest = z.infer<typeof V2IssueTokenRequestSchema>
export const V2TokenInfoSchema = z
  .object({
    id,
    scope: V2ScopeSchema,
    label: z.string(),
    issued_by_token_id: id.nullable(),
    created_at: timestamp,
    revoked_at: timestamp.nullable(),
  })
  .strict()
export type V2TokenInfo = z.infer<typeof V2TokenInfoSchema>
export const V2IssueTokenResponseSchema = z
  .object({ token: z.string(), info: V2TokenInfoSchema })
  .strict()
export type V2IssueTokenResponse = z.infer<typeof V2IssueTokenResponseSchema>
export const V2TokensResponseSchema = z.object({ items: z.array(V2TokenInfoSchema) }).strict()
export const V2RevokeTokenResponseSchema = z.object({ revoked: z.literal(true) }).strict()

const directory = z
  .object({
    file_id: id,
    path: PathSchema,
    kind: z.literal('directory'),
    version_id: id,
    mtime: integer,
  })
  .strict()
const file = z
  .object({
    file_id: id,
    path: PathSchema,
    kind: FileKindSchema,
    version_id: id,
    sha: ShaSchema,
    size: integer,
    mtime: integer,
  })
  .strict()
export const V2ManifestItemSchema = z.union([file, directory])
export type V2ManifestItem = z.infer<typeof V2ManifestItemSchema>
/** Snapshot cursor is fixed across pages. Only advance the local cursor after the last page. */
export const V2ManifestSchema = z
  .object({ items: z.array(V2ManifestItemSchema), cursor: integer, next: z.string().nullable() })
  .strict()
export type V2Manifest = z.infer<typeof V2ManifestSchema>
const change = { cursor: integer.positive(), file_id: id, path: PathSchema, at: timestamp }
export const V2ChangeSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...change,
      type: z.literal('content'),
      item: V2ManifestItemSchema,
      prev_path: PathSchema.nullable(),
    })
    .strict(),
  // Neither event carries the private destination. A departure is NOT a global delete.
  z.object({ ...change, type: z.literal('removal') }).strict(),
  z.object({ ...change, type: z.literal('delete'), version_id: id }).strict(),
])
export type V2Change = z.infer<typeof V2ChangeSchema>
export const V2ChangesSchema = z
  .object({ items: z.array(V2ChangeSchema), cursor: integer, next: z.string().nullable() })
  .strict()
export type V2Changes = z.infer<typeof V2ChangesSchema>
export const V2EventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('changes'), cursor: integer }).strict(),
  z
    .object({
      type: z.literal('connection'),
      status: z.enum(['revoked', 'scope_unavailable', 'scope_updating']),
    })
    .strict(),
])
export type V2Event = z.infer<typeof V2EventSchema>
export const V2CommitOpSchema = z.union([
  CommitOpSchema,
  z.object({ op: z.literal('mkdir'), path: PathSchema, mtime: integer.optional() }).strict(),
  z
    .object({
      op: z.literal('move_directory'),
      file_id: id,
      base_version_id: id,
      to_path: PathSchema,
    })
    .strict(),
  z.object({ op: z.literal('delete_directory'), file_id: id, base_version_id: id }).strict(),
])
export type V2CommitOp = z.infer<typeof V2CommitOpSchema>
export const V2CommitRequestSchema = z
  .object({ ops: z.array(V2CommitOpSchema).min(1).max(1000) })
  .strict()
export type V2CommitRequest = z.infer<typeof V2CommitRequestSchema>
export const V2CommitResponseSchema = z
  .object({ cursor: integer, results: z.array(CommitOpResultSchema) })
  .strict()
export type V2CommitResponse = z.infer<typeof V2CommitResponseSchema>
