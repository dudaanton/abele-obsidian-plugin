import { shallowRef, markRaw } from 'vue'
import type { PairedWssConnector } from '@abele/node-client'
import { decodePairCode, type PairCodePayload } from '@abele/node-protocol'
type Session = Pick<
  ReturnType<PairedWssConnector['createPairingSession']>,
  'state' | 'onChange' | 'decode' | 'connect' | 'cancel'
>
type Client = NonNullable<Awaited<ReturnType<Session['connect']>>>

/** Product admission wrapper around the SDK's foreground pairing state machine. */
export class NodePairingModel {
  readonly state = shallowRef<Session['state']>({ phase: 'paste' })
  private generation = 0
  constructor(
    readonly session: Session,
    private readonly remember: (payload: PairCodePayload) => Promise<void>,
    private readonly adopt: (
      client: Client,
      payload: PairCodePayload,
      current: () => boolean
    ) => Promise<void>
  ) {
    markRaw(this)
    session.onChange = (state) => {
      this.state.value =
        state.phase === 'connected' ? { ...state, phase: 'connecting' } : { ...state }
    }
  }
  async connect(
    code: string,
    deviceName: string,
    address: { host: string; port: number }
  ): Promise<void> {
    const generation = ++this.generation
    const current = () => generation === this.generation
    let client: Client | undefined
    let adopted = false
    try {
      const payload = decodePairCode(code)
      if (!this.session.decode(code)) return
      await this.remember(payload)
      if (!current()) return
      client = await this.session.connect(deviceName, address)
      if (!current() || !client) return
      if (!client.connected) throw new Error('Authenticated node connection did not complete.')
      await this.adopt(client, payload, current)
      adopted = true
      if (current()) this.state.value = { ...this.state.value, phase: 'connected' }
    } catch (error) {
      if (client && !adopted) await client.disconnect().catch(() => {})
      if (current())
        this.state.value = {
          ...this.state.value,
          phase: 'error',
          error: error instanceof Error ? error.message : 'Could not connect the node',
        }
    }
  }
  cancel(): void {
    ++this.generation
    this.session.cancel()
    this.state.value = { ...this.state.value, phase: 'cancelled' }
  }
}
