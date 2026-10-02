import { z } from 'zod'
import { LoginResponseSchema } from '@abele/sync-protocol'
import { SharingHttp, type SharingHttpOptions } from '../sharing/sharingHttp'
import {
  SCOPED_JOIN_ENABLED,
  type ScopedJoinPort,
  type ScopedMember,
  type ScopedInstallation,
} from './scopedJoin'
const id = z.string().min(1).max(200),
  role = z.enum(['reader', 'editor'])
const accepted = z.object({ grant_id: id, member_id: id, role }).strict()
const discovered = z
  .array(
    z
      .object({
        grant_id: id,
        member_id: id,
        vault_id: id,
        label: id,
        role,
        state: z.string(),
        root_file_id: id,
      })
      .strict()
  )
  .max(64)
const installation = z
  .object({
    installation_id: id,
    installation_token: z.string().regex(/^absi_[A-Za-z0-9_-]{43}$/),
    member_id: id,
  })
  .strict()
/** Exact 689779f account management contract. Scoped content is a distinct credential/client. */
export class GroupJoinHttp {
  private readonly http: SharingHttp
  constructor(options: SharingHttpOptions) {
    const transport = options.fetch
    this.http = new SharingHttp({
      ...options,
      enabled: options.enabled ?? (() => SCOPED_JOIN_ENABLED),
      fetch: (input, init) => {
        const headers = new Headers(init?.headers)
        headers.set('x-abele-scoped-version', '4')
        return transport(input, { ...init, headers })
      },
    })
  }
  private issuer(issuer: string) {
    if (issuer !== this.http.baseUrl) throw new Error('Scoped invitation issuer changed')
  }
  private account(token: string) {
    if (!/^abst_[A-Za-z0-9_-]{43}$/.test(token))
      throw new Error('Group management requires an account session')
  }
  async login(issuer: string, email: string, password: string) {
    this.issuer(issuer)
    const result = LoginResponseSchema.parse(
      await this.http.json('POST', '/v1/auth/login', null, { email, password })
    )
    this.account(result.account_token)
    return result.account_token
  }
  async accept(issuer: string, token: string, invitation: string) {
    this.issuer(issuer)
    this.account(token)
    if (!/^absinv_[A-Za-z0-9_-]{43}$/.test(invitation)) throw new Error('Invalid scoped invitation')
    const r = accepted.parse(
      await this.http.json('POST', '/v1/invitations/accept', token, {
        invitation_token: invitation,
      })
    )
    return { grantId: r.grant_id, memberId: r.member_id, role: r.role }
  }
  async discover(issuer: string, token: string): Promise<ScopedMember[]> {
    this.issuer(issuer)
    this.account(token)
    return discovered
      .parse(await this.http.json('GET', '/v1/scoped/discovery', token))
      .map((r) => ({
        grantId: r.grant_id,
        memberId: r.member_id,
        vaultId: r.vault_id,
        role: r.role,
        rootFileId: r.root_file_id,
        state: r.state,
      }))
  }
  async enrol(
    issuer: string,
    token: string,
    request: Parameters<ScopedJoinPort['enrol']>[2]
  ): Promise<ScopedInstallation> {
    this.issuer(issuer)
    this.account(token)
    const body = z
        .object({ attempt_id: id, name: id, platform: z.enum(['desktop', 'mobile']), role })
        .strict()
        .parse({
          attempt_id: request.attemptId,
          name: request.name,
          platform: request.platform,
          role: request.role,
        }),
      r = installation.parse(
        await this.http.json(
          'POST',
          '/v1/scoped/grants/' + encodeURIComponent(request.grantId) + '/installations',
          token,
          body
        )
      )
    return { installationId: r.installation_id, token: r.installation_token, memberId: r.member_id }
  }
}
