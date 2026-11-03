import { expect, it } from 'vitest'
import { poolVaultRegistry } from '../e2e/helpers/poolVaultRegistry'
it('reads a host registry separately from the current app identity', () => {
  expect(
    poolVaultRegistry({
      appId: 'wrong',
      vaultRegistry: {
        'sample-id': { name: 'Sample vault' },
        'other-id': { name: 'Other vault' },
      },
    })
  ).toMatchObject({
    available: true,
    vaults: [
      { name: 'Sample vault', id: 'sample-id' },
      { name: 'Other vault', id: 'other-id' },
    ],
  })
})
it('never treats the page current appId or a getter as independent registry evidence', () => {
  expect(
    poolVaultRegistry({ appId: 'sample-id', vault: { getName: () => 'Sample' } }).available
  ).toBe(false)
  expect(
    poolVaultRegistry({
      get vaultRegistry() {
        throw new Error('Getter must not run')
      },
    }).available
  ).toBe(false)
  expect(
    poolVaultRegistry({
      vaultRegistry: {
        'sample-id': {
          get name() {
            throw new Error('Getter must not run')
          },
        },
      },
    }).available
  ).toBe(false)
})
it('refuses empty, malformed and ambiguous maps', () => {
  for (const registry of [
    {},
    { 'bad/id': { name: 'Sample' } },
    { one: { name: 'Sample' }, two: { name: 'Sample' } },
  ])
    expect(poolVaultRegistry({ vaultRegistry: registry }).available).toBe(false)
})
