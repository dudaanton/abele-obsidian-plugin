// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { selectCandidate } from '../../scripts/select-candidate.mjs'

const revision = '1'.repeat(40)
const digest = 'a'.repeat(64)
const run = {
  id: 7,
  head_sha: revision,
  event: 'workflow_dispatch',
  conclusion: 'success',
  status: 'completed',
  path: '.github/workflows/candidate.yml',
}
function evidence() {
  return {
    runs: async () => [run],
    artifacts: async () => [
      { name: 'production', expired: false, digest: `sha256:${digest}` },
      { name: 'candidate-verification', expired: false },
    ],
    record: async () => ({ revision, artifact_digest: digest }),
  }
}
it('reuses only a complete exact-revision candidate and its immutable production digest', async () => {
  expect(await selectCandidate(revision, evidence())).toEqual({ runId: 7, digest })
})
it('fails closed on wrong revisions, recipes, event, scope evidence, expiry or digest', async () => {
  for (const patch of [
    { head_sha: '2'.repeat(40) },
    { event: 'pull_request' },
    { conclusion: 'failure' },
    { status: 'in_progress' },
    { path: '.github/workflows/other.yml' },
  ]) {
    const api = evidence()
    api.runs = async () => [{ ...run, ...patch }]
    expect(await selectCandidate(revision, api)).toBeNull()
  }
  const wrongRecord = evidence()
  wrongRecord.record = async () => ({ revision: '2'.repeat(40), artifact_digest: digest })
  expect(await selectCandidate(revision, wrongRecord)).toBeNull()
  const wrongDigest = evidence()
  wrongDigest.record = async () => ({ revision, artifact_digest: 'b'.repeat(64) })
  expect(await selectCandidate(revision, wrongDigest)).toBeNull()
  const expired = evidence()
  expired.artifacts = async () => [
    { name: 'production', expired: true, digest },
    { name: 'candidate-verification', expired: false },
  ]
  expect(await selectCandidate(revision, expired)).toBeNull()
})
it('unknown or interrupted evidence requires the full fallback gates', async () => {
  const api = evidence()
  api.record = vi.fn().mockRejectedValue(new Error('missing archive'))
  expect(await selectCandidate(revision, api)).toBeNull()
})
