import { beforeAll, expect, it } from 'vitest'
import { existsSync, mkdirSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { targets, onPhone } from './helpers/target'
import { liveScenarioHost, type ScenarioHost } from './helpers/scenarioHost'
import { evidenceManifest, runEvidence, type ScenarioDriver } from '../acceptance/evidence'
import { mappedSyncCases, caseKey } from './helpers/syncLiveCases'

targets('desktop', 'phone')

/** The local batch runner selects this file in its ordinary desktop/phone tier. No deployment driver is shipped. */
const output = process.env.ABELE_SCENARIO_EVIDENCE
const host = liveScenarioHost(),
  platform = host.platform
const requested = process.env.ABELE_SCENARIOS?.split(',').map(Number)
const mapped = mappedSyncCases().filter((one) =>
  onPhone() ? one.file === 'syncPhone' : one.file !== 'syncPhone'
)
const ids =
  requested ??
  [...new Set(mapped.flatMap((one) => one.scenarios))]
    .filter((id) =>
      evidenceManifest()
        .find((one) => one.id === id)
        ?.required.includes(platform)
    )
    .sort((a, b) => a - b)
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
  } else {
    scenarios = ids.map((id) => ({
      id,
      run: async () => {
        const cases = mapped.filter((one) => one.scenarios.includes(id))
        if (!cases.length) throw new Error('No live test mapped to this scenario')
        const checks: { name: string; expected: unknown; actual: unknown }[] = [],
          artifacts: string[] = []
        for (const one of cases) {
          const file = join(
            output,
            String(id).padStart(3, '0') +
              '-' +
              platform +
              '-' +
              caseKey(one.file, one.name) +
              '.json'
          )
          if (!existsSync(file))
            throw new Error('Mapped live test has not run: ' + one.file + ' / ' + one.name)
          const row = JSON.parse(readFileSync(file, 'utf8'))
          if (
            !process.env.ABELE_SYNC_EVIDENCE_RUN ||
            row.runId !== process.env.ABELE_SYNC_EVIDENCE_RUN ||
            row.status !== 'verified' ||
            row.platform !== platform ||
            row.case.file !== one.file ||
            row.case.name !== one.name
          )
            throw new Error('Mapped live test did not pass in this evidence run')
          checks.push(...row.checks)
          artifacts.push(...row.artifacts)
        }
        return { checks, artifacts }
      },
    }))
  }
})

it('maps each live token test to acceptance scenario numbers', () => {
  expect(mapped.length).toBeGreaterThan(0)
  for (const one of mapped) {
    expect(one.scenarios.length).toBeGreaterThan(0)
    expect(
      one.scenarios.every((id) => evidenceManifest().some((scenario) => scenario.id === id))
    ).toBe(true)
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
