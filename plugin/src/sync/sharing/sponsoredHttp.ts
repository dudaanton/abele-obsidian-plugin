import {
  CapabilitiesResponseSchema,
  AssetViewSchema,
  AssetMutationSchema,
  OwnerAssetAddSchema,
  NativeSponsoredCreateSchema,
  IntrinsicSponsorProofSchema,
} from '@abele/sync-protocol'
import { z } from 'zod'
import { SharingHttp, SharingHttpError, type SharingHttpOptions } from './sharingHttp'
import type {
  AssetView,
  AssetDelta,
  NativeCreate,
  OwnerAdd,
  SponsoredAssetPort,
} from './sponsoredAssets'
export interface SponsoredHttpOptions extends SharingHttpOptions {
  context?: {
    facet: 'personal' | 'scoped'
    vaultId: string
    principalId: string
    token: () => string | null
  }
}
/** Actual reviewed wire; facet/binding is mandatory and credentials never substitute one another. */
export class SponsoredAssetsHttpPort implements SponsoredAssetPort {
  private readonly http: SharingHttp
  constructor(private readonly options: SponsoredHttpOptions) {
    const transport = options.fetch
    this.http = new SharingHttp({
      ...options,
      fetch: (input, init) => {
        const headers = new Headers(init?.headers)
        headers.set('x-abele-scoped-version', '4')
        return transport(input, { ...init, headers })
      },
    })
  }
  private async unavailable(): Promise<never> {
    this.http.fence()
    CapabilitiesResponseSchema.parse(await this.http.json('GET', '/v1/capabilities', null))
    throw new SharingHttpError('sponsored_api_unavailable', 503)
  }
  private binding(facet?: 'personal' | 'scoped') {
    this.http.fence()
    const c = this.options.context
    if (!c) throw new SharingHttpError('sponsored_api_unavailable', 503)
    const token = c.token()
    if (
      !token ||
      !(
        c.facet === 'personal' ? /^absd_[A-Za-z0-9_-]{43}$/ : /^(?:absk_|absi_)[A-Za-z0-9_-]{43}$/
      ).test(token) ||
      (facet && c.facet !== facet)
    )
      throw new Error('Sponsored credential facet/binding invalid')
    return { ...c, token }
  }
  private path(grantId: string, facet?: 'personal' | 'scoped') {
    const c = this.binding(facet)
    return {
      token: c.token,
      base:
        '/v1/' +
        (c.facet === 'scoped' ? 'scoped/' : '') +
        'vaults/' +
        encodeURIComponent(c.vaultId) +
        '/grants/' +
        encodeURIComponent(grantId),
    }
  }
  async read(grantId: string): Promise<AssetView> {
    if (!this.options.context) return this.unavailable()
    const c = this.path(grantId),
      v = AssetViewSchema.parse(await this.http.json('GET', c.base + '/assets', c.token))
    if (v.grantId !== grantId) throw new Error('Sponsored response grant binding differs')
    return v
  }
  async mutate(
    grantId: string,
    delta: AssetDelta,
    revision: number,
    intentId: string
  ): Promise<AssetView> {
    if (!this.options.context) return this.unavailable()
    const c = this.path(grantId, 'personal'),
      body = AssetMutationSchema.parse({ expectedRevision: revision, intentId, delta }),
      v = AssetViewSchema.parse(
        await this.http.json('POST', c.base + '/assets/mutate', c.token, body)
      )
    if (v.grantId !== grantId) throw new Error('Sponsored response grant binding differs')
    return v
  }
  async add(request: OwnerAdd): Promise<AssetView> {
    const c = this.path(request.grantId, 'personal')
    const body = OwnerAssetAddSchema.parse(request)
    if (body.decisionDeviceId !== this.options.context.principalId)
      throw new Error('Publication decision device binding differs')
    const v = AssetViewSchema.parse(
      await this.http.json('POST', c.base + '/assets/add', c.token, body)
    )
    if (v.grantId !== request.grantId) throw new Error('Sponsored response grant binding differs')
    return v
  }
  async sponsorProof(grantId: string, fileId: string) {
    const c = this.path(grantId),
      proof = IntrinsicSponsorProofSchema.parse(
        await this.http.json(
          'GET',
          c.base + '/assets/sponsors/' + encodeURIComponent(fileId) + '/proof',
          c.token
        )
      )
    if (proof.grantId !== grantId || proof.sponsor.fileId !== fileId)
      throw new Error('Intrinsic sponsor proof identity differs')
    return proof.sponsor
  }
  async proof(grantId: string, sha: string) {
    const c = this.path(grantId, 'scoped')
    const p = z
      .object({
        sha: z.string().regex(/^[a-f0-9]{64}$/),
        size: z.number().int().nonnegative(),
        entitlementId: z.string().min(1),
      })
      .strict()
      .parse(
        await this.http.json(
          'GET',
          c.base + '/uploads/' + encodeURIComponent(sha) + '/proof',
          c.token
        )
      )
    if (p.sha !== sha) throw new Error('Upload proof SHA differs')
    return {
      sha: p.sha,
      entitlementId: p.entitlementId,
      principalId: this.options.context.principalId,
      grantId,
    }
  }
  async nativeCreate(
    grantId: string,
    request: NativeCreate
  ): Promise<{ fileId: string; versionId: string }> {
    if (!this.options.context) return this.unavailable()
    const c = this.path(grantId, 'scoped'),
      body = NativeSponsoredCreateSchema.parse(request)
    if (body.grantId !== grantId || body.upload.principalId !== this.options.context.principalId)
      throw new Error('Native create principal/grant binding differs')
    const result = z
      .object({ fileId: z.string().min(1), versionId: z.string().min(1) })
      .strict()
      .parse(await this.http.json('POST', c.base + '/assets/native', c.token, body))
    return { fileId: String(result.fileId), versionId: String(result.versionId) }
  }
}
