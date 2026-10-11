import { describe, expect, it, vi } from 'vitest'
import { encodePairCode, decodePairCode } from '@abele/node-protocol'
import type { PairedWssConnector } from '@abele/node-client'
import { NodePairingModel } from '@/node/NodePairingModel'
const code = encodePairCode({
  version: 1,
  node_name: 'Sample node',
  invite: {
    node_id: 'node-demo',
    endpoint: 'wss://sample.example.ts.net/channel',
    node_fingerprint: 'a'.repeat(64),
    invite_id: 'invite-demo',
    secret: 'b'.repeat(64),
    expires_at: Date.now() + 600000,
  },
})
type Session = Pick<
  ReturnType<PairedWssConnector['createPairingSession']>,
  'state' | 'onChange' | 'decode' | 'connect' | 'cancel'
>
function fake() {
  const client = {
    connected: true,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
  }
  const session: Session = {
    state: { phase: 'paste' },
    decode: vi.fn((text) => {
      const p = decodePairCode(text)
      return {
        nodeName: p.node_name,
        nodeId: p.invite.node_id,
        host: 'sample.example.ts.net',
        port: 443,
        fingerprint: p.invite.node_fingerprint,
        expiresAt: p.invite.expires_at,
      }
    }),
    connect: vi.fn(async () => {
      session.onChange?.({ phase: 'connected' })
      return client
    }),
    cancel: vi.fn(),
  }
  const remember = vi.fn(async () => {}),
    adopt = vi.fn(async () => {})
  return { client, session, remember, adopt, model: new NodePairingModel(session, remember, adopt) }
}
describe('product pairing admission', () => {
  it('does not expose connected before authenticated adoption succeeds', async () => {
    const f = fake()
    let finish!: () => void
    f.adopt.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const connected = f.model.connect(code, 'Sample device', {
      host: 'alternate.example.ts.net',
      port: 8443,
    })
    await vi.waitFor(() => expect(f.adopt).toHaveBeenCalledOnce())
    expect(f.model.state.value.phase).toBe('connecting')
    expect(f.session.connect).toHaveBeenCalledWith('Sample device', {
      host: 'alternate.example.ts.net',
      port: 8443,
    })
    finish()
    await connected
    expect(f.model.state.value.phase).toBe('connected')
  })
  it('fences cancellation while invitation recovery is being persisted', async () => {
    const f = fake()
    let finish!: () => void
    f.remember.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const connected = f.model.connect(code, 'Sample device', {
      host: 'sample.example.ts.net',
      port: 443,
    })
    f.model.cancel()
    finish()
    await connected
    expect(f.session.connect).not.toHaveBeenCalled()
    expect(f.adopt).not.toHaveBeenCalled()
  })
  it('disconnects a proven but unadopted client and keeps the dialog in error', async () => {
    const f = fake()
    f.adopt.mockRejectedValueOnce(new Error('local registration failed'))
    await f.model.connect(code, 'Sample device', { host: 'sample.example.ts.net', port: 443 })
    expect(f.model.state.value.phase).toBe('error')
    expect(f.client.disconnect).toHaveBeenCalledOnce()
  })
})
