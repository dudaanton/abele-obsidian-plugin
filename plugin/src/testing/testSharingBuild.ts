declare const __ABELE_TEST_SHARING__: boolean
/** Compile-time only. The entire testing graph is forbidden in production. */
export function testSharingBuild(): boolean {
  return typeof __ABELE_TEST_SHARING__ !== 'undefined' && __ABELE_TEST_SHARING__
}
export function fixtureSharingIssuerAllowed(issuer: string): boolean {
  const u = new URL(issuer)
  if (u.username || u.password || u.search || u.hash) return false
  return (
    (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname)) ||
    (testSharingBuild() && u.protocol === 'https:')
  )
}
