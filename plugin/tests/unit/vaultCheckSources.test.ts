import { expect, it } from 'vitest'
import { shallowRef } from 'vue'
import { publishVaultCheck, vaultChecks } from '@/sync/vaultCheck'
import type { VaultCheckSource, VaultCheckState } from '@/sync/vaultCheck'
const source = (): VaultCheckSource => ({
  state: shallowRef<VaultCheckState>({ kind: 'never' }),
  start: () => {},
  stop: () => {},
  send: async () => {},
})
it('isolates connection results and does not let a retiring runtime remove its successor', () => {
  const first = source(),
    second = source(),
    successor = source()
  const old = publishVaultCheck('sample-first', first)
  const other = publishVaultCheck('sample-second', second)
  const newer = publishVaultCheck('sample-first', successor)
  old()
  expect(vaultChecks.value.get('sample-first')).toBe(successor)
  expect(vaultChecks.value.get('sample-second')).toBe(second)
  newer()
  other()
  expect(vaultChecks.value.size).toBe(0)
})
