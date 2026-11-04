/** Server test input is independent of the installed core/protocol package pin. */
export const SERVER_TEST_COMMIT = '372d62e35cf15f320522005f320a7b29fb16edab'
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
    'nativeStoppedScopedRestart',
    'nativeLargePull',
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
