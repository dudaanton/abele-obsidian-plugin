// @vitest-environment node
import { expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  qualificationBuildConfig,
  qualificationScenario,
  instrumentationOf,
} from './qualification-config.mjs'
import { qualificationEntryBridge, validateQualificationArtifact } from './build.mjs'

it.each(['full', 'targeted'])('collects required reindex function coverage in %s', mode => {
  expect(qualificationScenario(mode).preciseHashCoverage).toBe(true)
})

it('prepares full and targeted builds with identical instrumentation, including legacy full input', () => {
  const full = qualificationBuildConfig({ scenarioConfig: { failureDiagnostic: true } })
  const targeted = qualificationBuildConfig({
    scenarioConfig: {
      targeted: true,
      continuousCpu: true,
      heapDiagnostics: false,
      longTasksReportOnly: false,
      contentSpacingMs: 0,
      visibilityDurationMs: 30000,
    },
  })
  expect(instrumentationOf(full.scenarioConfig)).toEqual(instrumentationOf(targeted.scenarioConfig))
  expect(full.scenarioConfig).toMatchObject({ continuousCpu: true, entryLedgerEnabled: true })
  expect(full.scenarioConfig.failureDiagnosticEnabled).toBe(true)
  expect(full.scenarioConfig).not.toHaveProperty('failureDiagnostic')
  expect(full.scenarioConfig.shape).toBe('scale')
  expect(targeted.scenarioConfig.shape).toBe('smoke')
  const differentKeys = [
    ...new Set([...Object.keys(full.scenarioConfig), ...Object.keys(targeted.scenarioConfig)]),
  ].filter(
    (key) =>
      JSON.stringify(full.scenarioConfig[key]) !== JSON.stringify(targeted.scenarioConfig[key])
  )
  expect(differentKeys.sort()).toEqual(['parameters', 'reindex', 'shape', 'targeted'])
  // A legacy guardian must not reintroduce a second instrumentation policy.
  expect(
    instrumentationOf(
      qualificationScenario('full', {
        ...full.scenarioConfig,
        continuousCpu: false,
        heapDiagnostics: true,
      })
    )
  ).toEqual(instrumentationOf(targeted.scenarioConfig))
})

it.each(['full', 'targeted'])(
  'passes the same qualification artifact gate for %s preparation',
  (mode) => {
    const config = qualificationBuildConfig({ scenarioConfig: { targeted: mode === 'targeted' } })
    const flags = config.scenarioConfig
    const main = qualificationEntryBridge(
      Buffer.from('module.exports = class SamplePlugin {}'),
      flags.continuousCpu && flags.entryLedgerEnabled
    )
    expect(main.toString()).toContain('__scaleWrapProductExport')
    const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex')
    const map = Buffer.from(
      JSON.stringify({ version: 3, sources: ['sample.ts'], mappings: 'AAAA' })
    )
    const receipt = {
      qualificationEntryBridge: true,
      sourceChanges: [],
      artifact: { files: { 'main.js': sha256(main) } },
      qualificationMap: { sha256: sha256(map), bundleSha256: sha256(main) },
    }
    expect(() => validateQualificationArtifact(receipt, main, map)).not.toThrow()
    expect(() =>
      validateQualificationArtifact({ ...receipt, qualificationEntryBridge: false }, main, map)
    ).toThrow('entry bridge')
    expect(() =>
      validateQualificationArtifact(receipt, Buffer.from('unmatched build'), map)
    ).toThrow('bundle')
    expect(() => validateQualificationArtifact(receipt, main, Buffer.from('{}'))).toThrow(
      'source map'
    )
  }
)
