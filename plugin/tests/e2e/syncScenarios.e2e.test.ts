import { beforeAll, expect, it } from 'vitest'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { targets, onPhone } from './helpers/target'
import { liveScenarioHost, type ScenarioHost } from './helpers/scenarioHost'
import { evidenceManifest, runEvidence, type ScenarioDriver } from '../acceptance/evidence'

targets('desktop', 'phone')

/** The local batch runner selects this file in its ordinary desktop/phone tier. No deployment driver is shipped. */
const output = process.env.ABELE_SCENARIO_EVIDENCE
const host = liveScenarioHost(),
  platform = host.platform
const requested = process.env.ABELE_SCENARIOS?.split(',').map(Number)
const ids =
  requested ??
  evidenceManifest()
    .filter((scenario) => scenario.required.includes(platform))
    .map((scenario) => scenario.id)
let scenarios: ScenarioDriver[] = []
beforeAll(async () => {
  if (!output) return
  const source = process.env.ABELE_SCENARIO_ACTIONS
  if (source) {
    try {
      // This is an explicit local harness module path, supplied by the batch owner, never vault content.
      // eslint-disable-next-line no-unsanitized/method -- Explicit trusted local harness module, never vault content.
      const module = (await import(/* @vite-ignore */ pathToFileURL(resolve(source)).href)) as {
        liveScenarios(host: ScenarioHost): Promise<ScenarioDriver[]>
      }
      scenarios = await module.liveScenarios(host)
    } catch {
      scenarios = ids.map((id) => ({
        id,
        run: async () => {
          throw new Error('Scenario action module unavailable')
        },
      }))
    }
  }
})

it.skipIf(!output).each(ids)(
  'records scenario %s live evidence',
  async (id) => {
    if (!output) throw new Error('Live evidence output directory unavailable')
    const drivers = scenarios.map((scenario) => ({
      ...scenario,
      run: async () => {
        const observation = await scenario.run()
        if (
          observation.artifacts.some(
            (artifact) => !existsSync(artifact) || !statSync(artifact).isFile()
          )
        )
          throw new Error('Live evidence artifact unavailable')
        return observation
      },
    }))
    const rows = await runEvidence(
      platform,
      onPhone() ? 'physical-phone' : 'desktop',
      [id],
      drivers
    )
    mkdirSync(output, { recursive: true })
    for (const row of rows)
      writeFileSync(
        join(output, `${row.scenario}-${platform}.json`),
        JSON.stringify(row, null, 2) + '\n'
      )
    expect(rows.filter((row) => row.status !== 'verified')).toEqual([])
  },
  180_000
)
