/** Server test input is independent of the installed core/protocol package pin. */
export const SERVER_TEST_COMMIT = '641e105873172a9554606678dc17257536d4654c'
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
