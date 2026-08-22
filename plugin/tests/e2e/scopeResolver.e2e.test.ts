/**
 * Cost of group scope resolution against a real running Obsidian.
 *
 * The integration tier already pins complexity using a fake vault. This tier confirms the
 * same shape against Obsidian's actual metadata cache, whose link resolution is far more
 * expensive per call than any stand-in — which is what turns a large operation count into a
 * multi-second freeze.
 *
 * The measurement is deliberately taken once and shared: on a large vault a single run costs
 * roughly two minutes, so repeating it per assertion would make the suite unusable.
 *
 * Requires a development build and OBSIDIAN_TEST_VAULT — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import {
  isObsidianRunning,
  hasTestApi,
  evalJson,
  activeVaultName,
  activeVaultFileCount,
} from './helpers/obsidianCli'

interface GroupResolveMeasurement {
  ms: number
  resolved: number
  getFilesCalls: number
  linkResolutions: number
  fileCacheReads: number
  vaultFiles: number
}

const MEGA_GROUP = process.env.OBSIDIAN_TEST_GROUP ?? 'ScaleTest/Notes/Projects.md'

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('ScopeResolver cost end-to-end', () => {
  let measurement: GroupResolveMeasurement

  beforeAll(() => {
    const exists = evalJson<boolean>(
      `app.vault.getAbstractFileByPath(${JSON.stringify(MEGA_GROUP)}) !== null`
    )
    if (!exists) {
      throw new Error(
        `Group note ${MEGA_GROUP} not found in vault "${activeVaultName()}". ` +
          'Generate one with scripts/generate-vault.mjs or set OBSIDIAN_TEST_GROUP.'
      )
    }

    measurement = evalJson<GroupResolveMeasurement>(
      `window.__abeleTest.measureGroupResolve(${JSON.stringify(MEGA_GROUP)})`,
      900_000
    )

    console.info(
      [
        '',
        `  vault ...................... ${activeVaultName()} (${activeVaultFileCount()} files)`,
        `  group ...................... ${MEGA_GROUP}`,
        `  resolved paths ............. ${measurement.resolved}`,
        `  vault.getFiles() ........... ${measurement.getFilesCalls.toLocaleString()}`,
        `  getFileCache() ............. ${measurement.fileCacheReads.toLocaleString()}`,
        `  getFirstLinkpathDest() ..... ${measurement.linkResolutions.toLocaleString()}`,
        `  wall clock ................. ${(measurement.ms / 1000).toFixed(1)}s`,
        '',
      ].join('\n')
    )
  }, 900_000)

  it('resolves the group to a non-trivial set of notes', () => {
    expect(measurement.resolved).toBeGreaterThan(1)
  })

  it('walks the vault file list a bounded number of times', () => {
    // One walk is enough to build a complete group index. A count that tracks the size of
    // the resolved set means the vault is rescanned once per group node.
    expect(measurement.getFilesCalls).toBeLessThanOrEqual(4)
  })

  it('resolves links proportionally to vault size, not closure x vault', () => {
    expect(measurement.linkResolutions).toBeLessThanOrEqual(measurement.vaultFiles * 2)
  })

  it('keeps a group scope resolution off the critical path', () => {
    // Resolution happens synchronously during agent tool calls, so anything above a fraction
    // of a second is a visible UI freeze rather than a slow background job.
    expect(measurement.ms).toBeLessThan(500)
  })
})
