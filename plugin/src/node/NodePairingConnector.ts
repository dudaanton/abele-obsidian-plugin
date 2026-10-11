import { PairedWssConnector } from '@abele/node-client'
import type { NodeDeviceKeyStore } from './NodeDeviceKeyStore'
/** Preserve the product's invitation recovery metadata around the shared SDK handshake. */
export class NodePairingConnector extends PairedWssConnector {
  constructor(
    private readonly deviceKeys: NodeDeviceKeyStore,
    open?: ConstructorParameters<typeof PairedWssConnector>[1]
  ) {
    super(deviceKeys, open)
  }
  override async claim(...args: Parameters<PairedWssConnector['claim']>) {
    const claim = await super.claim(...args)
    await this.deviceKeys.recordClaim(args[0], claim)
    return claim
  }
}
