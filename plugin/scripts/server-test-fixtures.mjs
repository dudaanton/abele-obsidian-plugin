/** Server test input is independent of the installed core/protocol package pin. */
export const SERVER_TEST_COMMIT = 'f927e62bb41817cd3cf0180e80f989e8c166ff1d'
/** Only fast-tier files whose setup uses a real, provenance-checked server archive. */
export const serverTestFixtures = {
  ABELE_SYNC_DIR: [
    'syncServer',
    'syncService',
    'syncHeldDeletes',
    'syncJoin',
    'syncStagedSettings',
    'syncHandover',
    'syncBundleReload',
    'syncOwnSettings',
    'syncConnectionSaves',
    'syncDevices',
    'scopedPublicationPush',
    'productionSharingBuild',
  ].map((name) => `tests/integration/${name}.test.ts`),
  ABELE_SCOPED_API_FIXTURE: [
    'tests/integration/ownerHttpApi.test.ts',
    'tests/integration/ownerSharingContracts.test.ts',
    'tests/integration/replayProbeHttp.test.ts',
    'tests/integration/sponsoredApiAvailability.test.ts',
  ],
  ABELE_SPONSORED_API_FIXTURE: [
    'tests/integration/sponsoredHttpApi.test.ts',
    'tests/integration/groupOwnerHttp.test.ts',
  ],
  ABELE_GROUP_API_FIXTURE: ['tests/integration/groupJoinHttp.test.ts'],
  ABELE_OWNER_RELEASE_FIXTURE: ['tests/integration/ownerSharingContracts.test.ts'],
}

// The installed core/protocol remain pinned independently of the released server contract.
export const serverTestFixtureRevisions = {
  ABELE_OWNER_RELEASE_FIXTURE: '019830418a035ba213d737048ba2499c8453da6e',
}
export function missingServerTests(env = process.env) {
  return [
    ...new Set(
      Object.entries(serverTestFixtures).flatMap(([variable, files]) =>
        env[variable] ? [] : files
      )
    ),
  ]
}
