/** Server test input is independent of the installed core/protocol package pin. */
export const SERVER_TEST_COMMIT = '76bc242fc95d3571b9dd8db97f48edfe80db76c1'
/** Only fast-tier files whose setup uses a real, provenance-checked server archive. */
export const serverTestFixtures = {
  ABELE_SYNC_DIR: [
    'tokenEngineServer',
    'serverDeleteServer',
    'serverDeleteInFlight',
    'syncServer',
    'interruptedMoveExchange',
    'externalRepresentationServer',
    'syncService',
    'syncHeldDeletes',
    'syncJoin',
    'syncStagedSettings',
    'syncBundleReload',
    'syncOwnSettings',
    'syncConnectionSaves',
    'productionSharingBuild',
  ]
    .map((name) => `tests/integration/${name}.test.ts`)
    .concat('tests/unit/syncLiveServer.test.ts'),
}

export const serverTestFixtureRevisions = {}
export function missingServerTests(env = process.env) {
  return [
    ...new Set(
      Object.entries(serverTestFixtures).flatMap(([variable, files]) =>
        env[variable] ? [] : files
      )
    ),
  ]
}
