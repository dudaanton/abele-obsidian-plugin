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
  ].map((name) => `tests/integration/${name}.test.ts`),
  ABELE_SCOPED_API_FIXTURE: [
    'tests/integration/ownerHttpApi.test.ts',
    'tests/integration/replayProbeHttp.test.ts',
    'tests/integration/sponsoredApiAvailability.test.ts',
  ],
  ABELE_SPONSORED_API_FIXTURE: [
    'tests/integration/sponsoredHttpApi.test.ts',
    'tests/integration/groupOwnerHttp.test.ts',
  ],
  ABELE_GROUP_API_FIXTURE: ['tests/integration/groupJoinHttp.test.ts'],
}

export function missingServerTests(env = process.env) {
  return Object.entries(serverTestFixtures).flatMap(([variable, files]) =>
    env[variable] ? [] : files
  )
}
