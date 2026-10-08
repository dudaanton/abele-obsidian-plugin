import { RuntimeFence } from './recovery'

/** Fence every request, not merely the outer client verb: multipart uploads have awaits
 * between their requests. Already-issued effects remain tracked for successor settlement. */
export function runtimeTransport(fence: RuntimeFence, send: typeof fetch): typeof fetch {
  return (input, init) => {
    try {
      fence.assertReady()
      return fence.effect(() => send(input, init))
    } catch (cause) {
      return Promise.reject(
        cause instanceof Error ? cause : new Error('Runtime request refused', { cause })
      )
    }
  }
}
