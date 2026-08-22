/**
 * Main-thread responsiveness around group scope resolution.
 *
 * Scope is resolved synchronously on the agent's tool-call path, so while it runs the app
 * cannot service a keystroke, a scroll or a click. The probe samples a 16ms timer — one
 * frame's budget — across a resolution and reports the longest stretch that timer went
 * unserviced. That stall is, precisely, how long the UI was frozen to the user.
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
} from './helpers/obsidianCli'

interface ResponsivenessSample {
  longestStallMs: number
  operationMs: number
  ticks: number
  resolved: number
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
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error('Responsiveness probe did not finish in time')
}

describe.skipIf(!available)('main-thread responsiveness', () => {
  let sample: ResponsivenessSample

  beforeAll(async () => {
    sample = await runProbe(MEGA_GROUP)
    console.info(
      [
        '',
        `  vault ...................... ${activeVaultName()}`,
        `  group ...................... ${MEGA_GROUP}`,
        `  resolved paths ............. ${sample.resolved}`,
        `  timer ticks observed ....... ${sample.ticks}`,
        `  operation .................. ${(sample.operationMs / 1000).toFixed(1)}s`,
        `  longest UI stall ........... ${(sample.longestStallMs / 1000).toFixed(1)}s`,
        '',
      ].join('\n')
    )
  }, 900_000)

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
