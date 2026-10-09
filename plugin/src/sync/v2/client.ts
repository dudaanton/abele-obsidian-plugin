import { z } from 'zod'
import { ERROR_CODES } from '@abele/sync-protocol'
import * as wire from './contract'

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

/** One authority and one API for root, folder and group tokens. No legacy fallback. */
export class V2Client {
  private readonly token: wire.V2AccessToken
  constructor(
    token: wire.V2AccessToken,
    private readonly transport: typeof fetch
  ) {
    try {
      this.token = wire.V2AccessTokenSchema.parse(token)
    } catch {
      throw new V2ClientError('bad-token')
    }
  }
  private async request<T>(
    route: string,
    schema: z.ZodType<T>,
    init: RequestInit = {}
  ): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set('Authorization', 'Bearer ' + this.token.key)
    if (init.body !== undefined) headers.set('Content-Type', 'application/json')
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
      throw new V2ClientError(response.status === 401 ? 'revoked' : code, response.status)
    }
    try {
      return schema.parse(await response.json())
    } catch {
      throw new V2ClientError('invalid-response', response.status)
    }
  }
  connection(): Promise<wire.V2Connection> {
    return this.request('connection', wire.V2ConnectionSchema)
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
