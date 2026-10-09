import { expect, it } from 'vitest'
import { liveRequirements, runEvidence, evidenceManifest } from '../acceptance/evidence'

it('accounts for every scenario and keeps server, desktop and physical phone evidence separate', () => {
  expect(evidenceManifest().map((item) => item.id)).toEqual(
    Array.from({ length: 124 }, (_, i) => i + 1)
  )
  expect(liveRequirements(10)).toEqual(['server', 'Mac'])
  expect(liveRequirements(118)).toEqual(['server', 'iPhone'])
  expect(liveRequirements(108)).toEqual(['server'])
})

it('cannot use simulation, missing actions, or an empty check list as live verification', async () => {
  const scenario = {
    id: 117,
    run: async () => ({
      checks: [{ name: 'received bytes', actual: 'sample', expected: 'sample' }],
      artifacts: ['sample.png'],
    }),
  }
  const simulated = await runEvidence('iPhone', 'simulation', [117], [scenario])
  expect(simulated[0].status).toBe('unverified')
  expect((await runEvidence('Mac', 'desktop', [7], []))[0].status).toBe('unverified')
  expect(
    (
      await runEvidence(
        'Mac',
        'desktop',
        [7],
        [{ id: 7, run: async () => ({ checks: [], artifacts: [] }) }]
      )
    )[0].status
  ).toBe('failed')
})

it('records failed behavioral assertions and verifies specified scenarios', async () => {
  const rows = await runEvidence(
    'server',
    'server',
    [30, 108],
    [
      {
        id: 30,
        run: async () => ({
          checks: [{ name: 'pending bytes', expected: 'original', actual: 'overwritten' }],
          artifacts: [],
        }),
      },
      {
        id: 108,
        run: async () => ({
          checks: [{ name: 'characterization', expected: true, actual: true }],
          artifacts: [],
        }),
      },
    ]
  )
  expect(rows.map((row) => row.status)).toEqual(['failed', 'verified'])
  expect(rows[0].checks[0].name).toBe('pending bytes')
})

it('treats the finalized conflict policies as specified acceptance', () => {
  expect(
    evidenceManifest()
      .filter((item) => item.id >= 108 && item.id <= 110)
      .map((item) => item.policy)
  ).toEqual(['specified', 'specified', 'specified'])
})
