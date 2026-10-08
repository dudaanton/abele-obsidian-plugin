import { BrowserRecordTransport } from '@abele/channel-client'
import { PairedWssConnector } from '@abele/node-client'
import type { NodeService } from '@/node/NodeService'

/** Test builds only: a loopback proxy emulates Serve without TLS or tailnet changes.
 * Authentication still uses the original invitation endpoint and pinned application key.
 */
export function pairedLoopbackTransport(service: NodeService, url: string): void {
  if (!/^ws:\/\/127\.0\.0\.1:\d+\/channel$/.test(url))
    throw new Error('Expected a loopback paired fixture')
  Object.defineProperty(service, 'pairedConnector', {
    value: new PairedWssConnector(service.deviceKeys, async () => {
      const socket = new WebSocket(url)
      const transport = new BrowserRecordTransport(socket)
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          void transport.close('timeout')
          reject(new Error('Fixture connection timed out'))
        }, 10000)
        socket.addEventListener(
          'open',
          () => {
            window.clearTimeout(timer)
            resolve()
          },
          { once: true }
        )
        socket.addEventListener(
          'error',
          () => {
            window.clearTimeout(timer)
            void transport.close('error')
            reject(new Error('Fixture connection failed'))
          },
          { once: true }
        )
      })
      return transport
    }),
    configurable: true,
  })
}
