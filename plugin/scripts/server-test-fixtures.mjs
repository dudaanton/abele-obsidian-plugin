/** Server test input is independent of the installed core/protocol package pin. */
export const SERVER_TEST_COMMIT = 'cf01a4abb764464a3bc4ab9ab3cb3d5bf1f0d62c'
/** Only fast-tier files whose setup uses a real, provenance-checked server archive. */
export const serverTestFixtures = {
  ABELE_SYNC_DIR: [
    'tokenEngineServer',
    'syncServer',
    'externalRepresentationServer',
    'syncService',
    'syncHeldDeletes',
    'syncJoin',
    'syncStagedSettings',
    'syncHandover',
    'syncBundleReload',
    'syncOwnSettings',
    'syncConnectionSaves',
    'syncDevices',
    'productionSharingBuild',
  ].map((name) => `tests/integration/${name}.test.ts`),
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
