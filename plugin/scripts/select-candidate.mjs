import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** A green branch name is not evidence. Only this recipe, all of its completed gates, the
 * exact revision and the immutable archive digest may replace tagged CI verification. */
export async function selectCandidate(revision, api) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Expected an exact candidate revision')
  const runs = await api.runs()
  for (const run of runs) {
    if (
      !Number.isSafeInteger(run.id) ||
      run.id <= 0 ||
      run.head_sha !== revision ||
      run.event !== 'workflow_dispatch' ||
      run.conclusion !== 'success' ||
      run.status !== 'completed' ||
      run.path !== '.github/workflows/candidate.yml'
    )
      continue
    try {
      const artifacts = await api.artifacts(run.id)
      const production = artifacts.filter((a) => a.name === 'production' && !a.expired)
      const records = artifacts.filter((a) => a.name === 'candidate-verification' && !a.expired)
      if (production.length !== 1 || records.length !== 1) continue
      const digest = production[0].digest?.replace(/^sha256:/, '')
      if (!/^[a-f0-9]{64}$/.test(digest ?? '')) continue
      const record = await api.record(run.id)
      if (record.revision !== revision || record.artifact_digest !== digest) continue
      return { runId: run.id, digest }
    } catch {
      /* Missing/expired/interrupted evidence is a miss, never a partial green. */
    }
  }
  return null
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const repo = process.env.REPO
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) throw new Error('Expected a repository')
  const gh = (args) =>
    execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const api = (path) => JSON.parse(gh(['api', `repos/${repo}/${path}`]))
  let selected = null
  try {
    selected = await selectCandidate(process.env.REVISION, {
      runs: async () =>
        api(
          'actions/workflows/candidate.yml/runs?event=workflow_dispatch&status=success&per_page=100'
        ).workflow_runs,
      artifacts: async (id) => api(`actions/runs/${id}/artifacts?per_page=100`).artifacts,
      record: async (id) => {
        const dir = mkdtempSync(join(tmpdir(), 'sample-candidate-'))
        try {
          gh([
            'run',
            'download',
            String(id),
            '--repo',
            repo,
            '--name',
            'candidate-verification',
            '--dir',
            dir,
          ])
          return JSON.parse(readFileSync(join(dir, 'candidate.json'), 'utf8'))
        } finally {
          rmSync(dir, { recursive: true, force: true })
        }
      },
    })
  } catch {
    console.warn('Candidate evidence unavailable; full tagged verification required.')
  }
  const at = process.argv.indexOf('--github-output')
  if (at !== -1) {
    const output = process.argv[at + 1]
    if (!output) throw new Error('--github-output requires a path')
    appendFileSync(
      output,
      `run_id=${selected?.runId ?? ''}\nartifact_digest=${selected?.digest ?? ''}\n`
    )
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(selected))
  else
    console.log(
      selected
        ? `Verified candidate run ${selected.runId}; production SHA-256 ${selected.digest}`
        : 'No matching candidate; full tagged verification required.'
    )
}
