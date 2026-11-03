import { expect, it } from 'vitest'
import { loadedVaultIdentity, poolVaultRegistry } from '../e2e/helpers/poolVaultRegistry'
it('labels the loaded vault identity as non-independent without making it registry evidence', () => {
  const host = { appId: 'sample-loaded-id', vault: { getName: () => 'Sample pool' } }
  expect(loadedVaultIdentity(host)).toEqual({
    name: 'Sample pool',
    appId: 'sample-loaded-id',
    independent: false,
  })
  expect(poolVaultRegistry(host).available).toBe(false)
})
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
