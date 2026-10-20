import { sha256 } from '../external/hash'
import {
  ERROR_CODES,
  V2_CAPABILITIES_HEADER,
  V2_READ_ONLY_CAPABILITY,
  V2DeleteScopeRequestSchema,
  V2DeleteScopeResponseSchema,
  V2ScopeItemSchema,
  V2ScopeItemsResponseSchema,
  V2AddScopeItemRequestSchema,
  V2RemoveScopeItemResponseSchema,
  V2_PREVIEW_FILE_LIMIT,
} from '@abele/sync-sdk/protocol'
import * as wire from './contract'
export type ScopeItem = ReturnType<typeof V2ScopeItemSchema.parse>
import { AccessClient, DEFAULT_SIMPLE_UPLOAD_BYTES } from '@abele/sync-sdk/core'
import { ShaSchema } from './fileSchemas'
import {
  UploadBeginRequestSchema,
  UploadBeginResponseSchema,
  UploadReceiptSchema,
} from './uploadSchemas'

export interface ContentQuery {
  versionId?: string
  range?: { start: number; end?: number }
  signal?: AbortSignal
}
const identifier = (value: string) => {
  if (!value || value.length > 200 || value === '.' || value === '..')
    throw new V2ClientError('invalid-request')
  return encodeURIComponent(value)
}

export class V2ClientError extends Error {
  constructor(
    readonly code: string,
    readonly status = 0
  ) {
    super(`Sync connection: ${code}`)
  }
}
export function decodeAccessToken(text: string): wire.V2AccessToken {
  try {
    return wire.decodeAccessToken(text)
  } catch {
    throw new V2ClientError('bad-token')
  }
}
export function tokenScope(token: wire.V2AccessToken, item?: string): wire.V2Scope {
  if (token.v === 1) return token.scope
  const preview = item === undefined ? token.items[0] : token.items.find((one) => one.id === item)
  if (!preview) throw new V2ClientError('bad-token')
  return { kind: preview.kind, id: preview.scope_id, path: preview.path }
}

/** One authority and one API for root, folder and group tokens. No legacy fallback. */
export class V2Client {
  private readonly token: wire.V2AccessToken
  constructor(
    token: wire.V2AccessToken,
    private readonly transport: typeof fetch,
    private readonly item?: string
  ) {
    try {
      this.token = wire.V2AccessTokenSchema.parse(token)
    } catch {
      throw new V2ClientError('bad-token')
    }
  }
  itemClient() {
    // Management is key-level; a detached content item must not select its authority.
    const client = new V2Client(this.token, this.transport, this.item)
    const inventory = new V2Client(this.token, this.transport)
    const items = () => inventory.request('connection/items', V2ScopeItemsResponseSchema)
    return {
      items,
      supportsItems: async () => {
        try {
          await items()
          return true
        } catch (error) {
          if (error instanceof V2ClientError && error.status === 404) return false
          throw error
        }
      },
      tokenItems: (tokenId: string) =>
        client.request('tokens/' + identifier(tokenId) + '/items', V2ScopeItemsResponseSchema),
      addItem: (tokenId: string, scope: wire.V2Selector) =>
        client.request('tokens/' + identifier(tokenId) + '/items', V2ScopeItemSchema, {
          method: 'POST',
          body: JSON.stringify(V2AddScopeItemRequestSchema.parse({ scope })),
        }),
      removeItem: (tokenId: string, itemId: string) =>
        client.request(
          'tokens/' + identifier(tokenId) + '/items/' + identifier(itemId),
          V2RemoveScopeItemResponseSchema,
          { method: 'DELETE' }
        ),
      deleteItem: (itemId: string, requestId: string) =>
        client.request(
          'connection/items/' + identifier(itemId) + '/delete',
          V2DeleteScopeResponseSchema,
          { method: 'POST', body: '{}', headers: { 'idempotency-key': requestId } }
        ),
    }
  }
  /** Owner listing stays behind this port while older item servers lack the route. */
  ownedItems(tokenId: string) {
    return this.itemClient().tokenItems(tokenId)
  }
  previewTokenItem(tokenId: string, itemId: string) {
    return new AccessClient(this.token, {
      fetch: this.transport,
      item: this.item,
    }).previewTokenItem(tokenId, itemId, { limit: V2_PREVIEW_FILE_LIMIT })
  }
  previewToken(tokenId: string) {
    return new AccessClient(this.token, { fetch: this.transport, item: this.item }).previewToken(
      tokenId,
      { limit: V2_PREVIEW_FILE_LIMIT }
    )
  }
  private async request<T>(
    route: string,
    schema: { parse(value: unknown): T },
    init: RequestInit = {}
  ): Promise<T> {
    const response = await this.response(route, init)
    try {
      return schema.parse(await response.json())
    } catch {
      throw new V2ClientError('invalid-response', response.status)
    }
  }
  private async response(route: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set(V2_CAPABILITIES_HEADER, V2_READ_ONLY_CAPABILITY)
    headers.set('Authorization', 'Bearer ' + this.token.key)
    if (this.item) headers.set('abele-scope-item', this.item)
    if (init.body !== undefined && !headers.has('Content-Type'))
      headers.set('Content-Type', 'application/json')
    let response: Response
    try {
      response = await this.transport(this.token.address + '/v2/' + route, {
        ...init,
        headers,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
      })
    } catch {
      throw new V2ClientError('unreachable')
    }
    if (!response.ok) {
      let code = 'server-error'
      try {
        const body = await response.json()
        if (
          typeof body?.error?.code === 'string' &&
          (ERROR_CODES as readonly string[]).includes(body.error.code)
        )
          code = body.error.code
      } catch {
        /* A proxy response cannot provide a server error code. */
      }
      // A scope deleted on the server is not an ordinary revocation: say which one it was.
      throw new V2ClientError(
        response.status === 401 && code !== 'scope_deleted' ? 'revoked' : code,
        response.status
      )
    }
    return response
  }
  private uploadRoute(sha: string): string {
    if (!ShaSchema.safeParse(sha).success) throw new V2ClientError('invalid-request')
    return 'uploads/' + sha
  }
  beginUpload(sha: string, size: number, signal?: AbortSignal) {
    return this.request(this.uploadRoute(sha) + '/begin', UploadBeginResponseSchema, {
      method: 'POST',
      body: JSON.stringify(UploadBeginRequestSchema.parse({ size })),
      signal,
    })
  }
  async uploadPart(
    sha: string,
    uploadId: string,
    part: number,
    bytes: Uint8Array,
    signal?: AbortSignal
  ): Promise<void> {
    if (!Number.isSafeInteger(part) || part < 0) throw new V2ClientError('invalid-request')
    const response = await this.response(
      this.uploadRoute(sha) + '/' + identifier(uploadId) + '/' + part,
      {
        method: 'PUT',
        body: bytes.slice(),
        headers: { 'Content-Type': 'application/octet-stream' },
        signal,
      }
    )
    if (response.status !== 204) throw new V2ClientError('invalid-response')
  }
  async completeUpload(
    sha: string,
    uploadId: string,
    size: number,
    signal?: AbortSignal
  ): Promise<void> {
    const result = await this.request(
      this.uploadRoute(sha) + '/' + identifier(uploadId) + '/complete',
      UploadReceiptSchema,
      { method: 'POST', signal }
    )
    if (result.sha !== sha || result.size !== size) throw new V2ClientError('invalid-response')
  }
  /** Actual immutable bytes are uploaded; a readable digest alone is never an upload shortcut. */
  async putContent(
    sha: string,
    source: Uint8Array,
    options: { simpleUploadBytes?: number; signal?: AbortSignal } = {}
  ): Promise<void> {
    const route = this.uploadRoute(sha),
      bytes = source.slice()
    const limit = options.simpleUploadBytes ?? DEFAULT_SIMPLE_UPLOAD_BYTES
    if (!Number.isSafeInteger(limit) || limit < 0) throw new V2ClientError('invalid-request')
    if ((await sha256(bytes)) !== sha) throw new V2ClientError('hash_mismatch')
    if (bytes.length <= limit) {
      const result = await this.request(route, UploadReceiptSchema, {
        method: 'PUT',
        body: bytes,
        headers: { 'Content-Type': 'application/octet-stream' },
        signal: options.signal,
      })
      if (result.sha !== sha || result.size !== bytes.length)
        throw new V2ClientError('invalid-response')
      return
    }
    const begun = await this.beginUpload(sha, bytes.length, options.signal)
    if (
      begun.parts !== Math.ceil(bytes.length / begun.part_size) ||
      (begun.received ?? []).some((part) => part >= begun.parts)
    )
      throw new V2ClientError('invalid-response')
    const received = new Set(begun.received ?? [])
    for (let part = 0; part < begun.parts; part++) {
      if (!received.has(part))
        await this.uploadPart(
          sha,
          begun.upload_id,
          part,
          bytes.slice(part * begun.part_size, (part + 1) * begun.part_size),
          options.signal
        )
    }
    await this.completeUpload(sha, begun.upload_id, bytes.length, options.signal)
  }
  private contentRoute(fileId: string, query: ContentQuery): string {
    if (query.versionId !== undefined) identifier(query.versionId)
    return (
      'files/' +
      identifier(fileId) +
      '/content' +
      (query.versionId === undefined
        ? ''
        : '?' + new URLSearchParams({ version_id: query.versionId }).toString())
    )
  }
  async headContent(
    fileId: string,
    query: Omit<ContentQuery, 'range'> = {}
  ): Promise<{ size: number; acceptRanges: boolean }> {
    const response = await this.response(this.contentRoute(fileId, query), {
      method: 'HEAD',
      signal: query.signal,
    })
    const length = response.headers.get('content-length')
    if (
      response.status !== 200 ||
      length === null ||
      !/^\d+$/.test(length) ||
      !Number.isSafeInteger(Number(length))
    )
      throw new V2ClientError('invalid-response')
    return { size: Number(length), acceptRanges: response.headers.get('accept-ranges') === 'bytes' }
  }
  async content(fileId: string, query: ContentQuery = {}): Promise<Uint8Array> {
    const headers = new Headers(),
      range = query.range
    if (range) {
      if (
        !Number.isSafeInteger(range.start) ||
        range.start < 0 ||
        (range.end !== undefined && (!Number.isSafeInteger(range.end) || range.end < range.start))
      )
        throw new V2ClientError('invalid-request')
      headers.set('Range', `bytes=${range.start}-${range.end ?? ''}`)
    }
    const response = await this.response(this.contentRoute(fileId, query), {
      headers,
      signal: query.signal,
    })
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await response.arrayBuffer())
    } catch {
      throw new V2ClientError('unreachable')
    }
    const length = response.headers.get('content-length')
    if (length !== null && (!/^\d+$/.test(length) || Number(length) !== bytes.length))
      throw new V2ClientError('invalid-response')
    if (range) {
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '')
      if (response.status !== 206 || !match) throw new V2ClientError('invalid-response')
      const [start, end, total] = match.slice(1).map(Number)
      if (
        ![start, end, total].every(Number.isSafeInteger) ||
        start !== range.start ||
        end !== Math.min(range.end ?? total - 1, total - 1) ||
        end < start ||
        bytes.length !== end - start + 1
      )
        throw new V2ClientError('invalid-response')
    } else if (response.status !== 200) throw new V2ClientError('invalid-response')
    return bytes
  }
  connection(signal?: AbortSignal): Promise<wire.V2Connection> {
    return this.request('connection', wire.V2ConnectionSchema, { signal })
  }
  /** The server owns scope selection; retries replay the original self-revocation receipt. */
  deleteScope(requestId: string) {
    return this.request('connection/delete', V2DeleteScopeResponseSchema, {
      method: 'POST',
      headers: { 'Idempotency-Key': requestId },
      body: JSON.stringify(V2DeleteScopeRequestSchema.parse({})),
    }).catch((error) => {
      if (error instanceof V2ClientError && [404, 405].includes(error.status))
        throw new Error('This server is too old to delete a connection. Update the server first.')
      throw error
    })
  }
  issue(input: wire.V2IssueTokenRequest): Promise<wire.V2IssueTokenResponse> {
    return this.request('tokens', wire.V2IssueTokenResponseSchema, {
      method: 'POST',
      body: JSON.stringify(wire.V2IssueTokenRequestSchema.parse(input)),
    })
  }
  tokens() {
    return this.request('tokens', wire.V2TokensResponseSchema)
  }
  revoke(id: string) {
    if (!id || id.length > 200) throw new V2ClientError('invalid-request')
    return this.request('tokens/' + encodeURIComponent(id), wire.V2RevokeTokenResponseSchema, {
      method: 'DELETE',
    })
  }
  manifest(next: string | null = null): Promise<wire.V2Manifest> {
    return this.request(
      'manifest' + (next === null ? '' : '?' + new URLSearchParams({ next }).toString()),
      wire.V2ManifestSchema
    )
  }
  changes(since: number, next: string | null = null): Promise<wire.V2Changes> {
    if (!Number.isSafeInteger(since) || since < 0) throw new V2ClientError('invalid-request')
    const query = new URLSearchParams({ since: String(since) })
    if (next !== null) query.set('next', next)
    return this.request('changes?' + query.toString(), wire.V2ChangesSchema)
  }
  async commit(ops: wire.V2CommitOp[], requestId: string): Promise<wire.V2CommitResponse> {
    if (!requestId.trim()) throw new V2ClientError('invalid-request')
    const result = await this.request('commit', wire.V2CommitResponseSchema, {
      method: 'POST',
      headers: { 'Idempotency-Key': requestId },
      body: JSON.stringify(wire.V2CommitRequestSchema.parse({ ops })),
    })
    if (result.results.length !== ops.length) throw new V2ClientError('invalid-response')
    return result
  }
}
