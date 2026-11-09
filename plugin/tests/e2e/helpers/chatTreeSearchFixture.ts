/** Names shared by the live probe and its retained-fixture search regression. */
export function chatTreeSearchFixture(runId: string) {
  // A failed run can leave an open chat; search must target this run's closed transcript.
  const title = 'Sample navigation chat ' + runId
  return { title, query: title }
}
