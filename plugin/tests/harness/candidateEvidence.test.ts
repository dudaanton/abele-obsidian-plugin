// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
it('runs the candidate CLI against a fake API and emits human output and bounded promotion fields', () => {
  const root = mkdtempSync(join(tmpdir(), 'sample-candidate-cli-'))
  try {
    const tools = join(root, 'tools')
    mkdirSync(tools)
    const fake = `#!/usr/bin/env node
      const fs = require('node:fs'); const args = process.argv.slice(2);
      if (args[0] === 'api') console.log(JSON.stringify(args[1].includes('/runs?') ? {workflow_runs: JSON.parse(process.env.SAMPLE_RUNS)} : {artifacts: JSON.parse(process.env.SAMPLE_ARTIFACTS)}));
      else if (args[0] === 'run' && args[1] === 'download') fs.writeFileSync(args[args.indexOf('--dir')+1] + '/candidate.json', process.env.SAMPLE_RECORD);
      else process.exit(1);
    `
    writeFileSync(join(tools, 'gh'), fake)
    chmodSync(join(tools, 'gh'), 0o755)
    const output = join(root, 'outputs')
    const invoke = (recordRevision = revision) =>
      execFileSync(
        process.execPath,
        [resolve('scripts/select-candidate.mjs'), '--github-output', output],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${tools}:${process.env.PATH}`,
            REPO: 'sample/example',
            REVISION: revision,
            SAMPLE_RUNS: JSON.stringify([run]),
            SAMPLE_ARTIFACTS: JSON.stringify([
              { name: 'production', expired: false, digest },
              { name: 'candidate-verification', expired: false },
            ]),
            SAMPLE_RECORD: JSON.stringify({ revision: recordRevision, artifact_digest: digest }),
          },
        }
      )
    expect(invoke()).toContain('Verified candidate run 7')
    expect(readFileSync(output, 'utf8')).toBe(`run_id=7\nartifact_digest=${digest}\n`)
    writeFileSync(output, '')
    expect(invoke('2'.repeat(40))).toContain('full tagged verification required')
    expect(readFileSync(output, 'utf8')).toBe('run_id=\nartifact_digest=\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('unknown or interrupted evidence requires the full fallback gates', async () => {
  const api = evidence()
  api.record = vi.fn().mockRejectedValue(new Error('missing archive'))
  expect(await selectCandidate(revision, api)).toBeNull()
})
