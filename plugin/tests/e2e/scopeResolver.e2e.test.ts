/**
 * Cost of group scope resolution against a real running Obsidian, and what it does to the UI.
 *
 * The integration tier already pins complexity using a fake vault. This tier confirms the
 * same shape against Obsidian's actual metadata cache, whose link resolution is far more
 * expensive per call than any stand-in — which is what turns a large operation count into a
 * multi-second freeze.
 *
 * Scope is resolved synchronously on the agent's tool-call path, so while it runs the app
 * cannot service a keystroke, a scroll or a click. The probe samples a 16ms timer — one
 * frame's budget — across a resolution and reports the longest stretch that timer went
 * unserviced. That stall is, precisely, how long the UI was frozen to the user. The same
 * resolution's calls into the vault are counted, so the operation counts and the stall come
 * from one run.
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
  evalRaw,
  activeVaultName,
  activeVaultFileCount,
} from './helpers/obsidianCli'

interface ResponsivenessSample {
  longestStallMs: number
  operationMs: number
  ticks: number
  resolved: number
  counts: {
    getFilesCalls: number
    linkResolutions: number
    fileCacheReads: number
    vaultFiles: number
  }
}

const MEGA_GROUP = process.env.OBSIDIAN_TEST_GROUP ?? 'ScaleTest/Notes/Projects.md'

/** One dropped frame is 16ms. A stall an order of magnitude above that is user-visible. */
const ACCEPTABLE_STALL_MS = 150

const available = isObsidianRunning() && hasTestApi()

async function runProbe(groupPath: string): Promise<ResponsivenessSample> {
  evalRaw(
    `(() => { window.__abeleTest.startResponsivenessProbe(${JSON.stringify(groupPath)});
      return 'started' })()`,
    60_000
  )

  const deadline = Date.now() + 900_000
  while (Date.now() < deadline) {
    const done = evalJson<boolean>('window.__abeleTest.responsivenessResult !== null', 900_000)
    if (done) {
      return evalJson<ResponsivenessSample>('window.__abeleTest.responsivenessResult', 60_000)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Responsiveness probe did not finish in time')
}

// One resolution, read by both parts below.
let sample: ResponsivenessSample
let counts: ResponsivenessSample['counts']

describe.skipIf(!available)('ScopeResolver cost end-to-end', () => {
  beforeAll(async () => {
    const exists = evalJson<boolean>(
      `app.vault.getAbstractFileByPath(${JSON.stringify(MEGA_GROUP)}) !== null`
    )
    if (!exists) {
      throw new Error(
        `Group note ${MEGA_GROUP} not found in vault "${activeVaultName()}". ` +
          'Generate one with scripts/generate-vault.mjs or set OBSIDIAN_TEST_GROUP.'
      )
    }

    sample = await runProbe(MEGA_GROUP)
    counts = sample.counts

    console.info(
      [
        '',
        `  vault ...................... ${activeVaultName()} (${activeVaultFileCount()} files)`,
        `  group ...................... ${MEGA_GROUP}`,
        `  resolved paths ............. ${sample.resolved}`,
        `  vault.getFiles() ........... ${counts.getFilesCalls.toLocaleString()}`,
        `  getFileCache() ............. ${counts.fileCacheReads.toLocaleString()}`,
        `  getFirstLinkpathDest() ..... ${counts.linkResolutions.toLocaleString()}`,
        `  timer ticks observed ....... ${sample.ticks}`,
        `  operation .................. ${(sample.operationMs / 1000).toFixed(1)}s`,
        `  longest UI stall ........... ${(sample.longestStallMs / 1000).toFixed(1)}s`,
        '',
      ].join('\n')
    )
  }, 900_000)

  it('resolves the group to a non-trivial set of notes', () => {
    expect(sample.resolved).toBeGreaterThan(1)
  })

  it('walks the vault file list a bounded number of times', () => {
    // One walk is enough to build a complete group index. A count that tracks the size of
    // the resolved set means the vault is rescanned once per group node.
    expect(counts.getFilesCalls).toBeLessThanOrEqual(4)
  })

  it('resolves links proportionally to vault size, not closure x vault', () => {
    expect(counts.linkResolutions).toBeLessThanOrEqual(counts.vaultFiles * 2)
  })

  it('bounds the remaining metadata work of a synchronous group resolution', () => {
    // Time is reported above, but load on the host must not decide correctness. Together
    // with the sweep/link bounds, this prohibits closure-by-vault work on the critical path.
    expect(counts.fileCacheReads).toBeLessThanOrEqual(counts.vaultFiles * 2)
  })
})

describe.skipIf(!available)('main-thread responsiveness', () => {
  it('keeps the UI responsive while a group scope resolves', () => {
    expect(sample.longestStallMs).toBeLessThan(ACCEPTABLE_STALL_MS)
  })

  it('finishes a group resolution quickly enough that blocking does not matter', () => {
    // Resolution is still synchronous, so the stall necessarily tracks the operation's own
    // duration — there is no point asserting the two differ. What matters is that the
    // operation is short enough for that to be harmless. Bounding it here, rather than only
    // bounding the stall above, keeps a regression in the algorithm visible even if timer
    // sampling happens to miss the worst moment.
    expect(sample.operationMs).toBeLessThan(ACCEPTABLE_STALL_MS)
  })
})
