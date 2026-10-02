import { CapabilitiesResponseSchema } from '@abele/sync-protocol'
import { SharingHttp, SharingHttpError, type SharingHttpOptions } from './sharingHttp'
import type { AssetView, AssetDelta, NativeCreate, SponsoredAssetPort } from './sponsoredAssets'
/** 9b1136a registers management/scoped sync, but NO sponsored-list/native-sponsor wire schema.
 * This concrete capability boundary intentionally refuses instead of inventing a mutation path,
 * returning an empty private list, dropping sponsors, or falling back to personal credentials.
 */
export class SponsoredAssetsHttpPort implements SponsoredAssetPort {
  private readonly http: SharingHttp
  constructor(options: SharingHttpOptions) {
    this.http = new SharingHttp(options)
  }
  private async unavailable(): Promise<never> {
    this.http.fence()
    const capabilities = await this.http.json('GET', '/v1/capabilities', null)
    // Validate actual response before exposing a typed unavailable result.
    CapabilitiesResponseSchema.parse(capabilities)
    throw new SharingHttpError('sponsored_api_unavailable', 503)
  }
  read(_grantId: string): Promise<AssetView> {
    return this.unavailable()
  }
  mutate(
    _grantId: string,
    _delta: AssetDelta,
    _revision: number,
    _intentId: string
  ): Promise<AssetView> {
    return this.unavailable()
  }
  nativeCreate(
    _grantId: string,
    _request: NativeCreate
  ): Promise<{ fileId: string; versionId: string }> {
    return this.unavailable()
  }
}
