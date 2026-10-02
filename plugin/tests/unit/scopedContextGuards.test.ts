// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { Enrolment } from '@/sync/enrolment'
import { emptyConnection } from '@/sync/connection'
import { assertNoScriptContextHold } from '@/scripting/trust/scriptContextHold'
import { SCOPED_JOIN_KEY, SCOPED_CONNECTION_KEY } from '@/sync/scoped/scopedJoin'
describe('scoped receiver remains disjoint from personal enrolment and execution', () => {
  it.each([SCOPED_JOIN_KEY, SCOPED_CONNECTION_KEY])(
    'blocks personal credentials and scripts with %s present',
    async (key) => {
      const storage = {
          loadLocalStorage: (k: string) => (k === key ? { sample: true } : null),
          saveLocalStorage: vi.fn(),
        },
        transport = vi.fn(async () => new Response('{}'))
      const enrol = new Enrolment({
        app: () => storage,
        transport: () => transport,
        note: vi.fn(),
        connection: () => emptyConnection(),
      } as any)
      await expect(
        enrol.connect('https://sync.example', 'sample@example.com', 'invented-password')
      ).rejects.toThrow(/scoped/i)
      expect(transport).not.toHaveBeenCalled()
      expect(() => assertNoScriptContextHold(storage)).toThrow(/scoped|refuse/i)
    }
  )
})
