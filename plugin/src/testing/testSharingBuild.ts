declare const __ABELE_TEST_SHARING__: boolean
/** Compile-time only. The entire testing graph is forbidden in production. */
export function testSharingBuild(): boolean {
  return typeof __ABELE_TEST_SHARING__ !== 'undefined' && __ABELE_TEST_SHARING__
}
