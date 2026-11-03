// One policy for build-time derivation and runtime observers. Phase/fixture
// overrides must never silently disable a qualification instrument.
export const qualificationInstrumentation = Object.freeze({
  continuousCpu: true,
  entryLedgerEnabled: true,
  failureDiagnostic: true,
  preciseHashCoverage: false,
  strictRestartMeasurement: false,
  heapDiagnostics: false,
  longTasksReportOnly: false,
})

export function qualificationScenario(mode, overrides = {}) {
  if (!['full', 'targeted'].includes(mode)) throw new Error('Unknown qualification mode')
  const targeted = mode === 'targeted'
  return {
    targeted,
    shape: targeted ? 'smoke' : 'scale',
    seed: 42,
    reindex: !targeted,
    contentSpacingMs: 0,
    visibilityDurationMs: 30000,
    ...(targeted ? { parameters: { files: 5000, bytes: 1789569707, wideFolderFiles: 512 } } : {}),
    ...overrides,
    ...qualificationInstrumentation,
  }
}
export function qualificationBuildConfig(config) {
  return {
    ...config,
    scenarioConfig: qualificationScenario(
      config.scenarioConfig?.targeted ? 'targeted' : 'full',
      config.scenarioConfig
    ),
  }
}
export function instrumentationOf(config) {
  return Object.fromEntries(
    Object.keys(qualificationInstrumentation).map((key) => [key, config[key]])
  )
}
