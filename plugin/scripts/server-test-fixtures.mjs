/** Server test input is independent of the installed core/protocol package pin. */
export const SERVER_TEST_COMMIT = 'e74e09630c6be9dae6a1892421434088621d481f'
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
