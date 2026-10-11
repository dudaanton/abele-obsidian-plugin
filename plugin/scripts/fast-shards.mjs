import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
function inventory(files) {
  if (!Array.isArray(files) || !files.length) throw new Error('Empty fast inventory')
  for (const file of files)
    if (
      typeof file !== 'string' ||
      !/^tests\/(unit|component|integration|harness)\/.+\.test\.ts$/.test(file) ||
      file.includes('\\') ||
      file.includes('\0') ||
      file.split('/').some((p) => p === '..' || p === '.' || !p)
    )
      throw new Error('Invalid fast test path')
  if (new Set(files).size !== files.length) throw new Error('Duplicate fast file')
  return [...files].sort()
}

/** Longest-processing-time scheduling; measured module time plus a minimum startup weight.
 * Unknown files get the median measured weight. Durations affect scheduling, never coverage. */
export function makePlan(expected, durations = {}, count = 2, identity) {
  expected = inventory(expected)
  if (!Number.isInteger(count) || count < 1 || count > expected.length)
    throw new Error('Invalid shard count')
  if (typeof identity !== 'string' || !identity) throw new Error('Missing complete input identity')
  const known = expected
    .map((f) => durations[f])
    .filter((n) => Number.isFinite(n) && n >= 0)
    .map((n) => Math.max(400, n))
    .sort((a, b) => a - b)
  const fallback = known[Math.floor(known.length / 2)] ?? 400
  const weight = (file) =>
    Number.isFinite(durations[file]) && durations[file] >= 0
      ? Math.max(400, durations[file])
      : fallback
  const shards = Array.from({ length: count }, () => ({ files: [], durationMs: 0 }))
  for (const file of [...expected].sort(
    (a, b) => weight(b) - weight(a) || (a < b ? -1 : a > b ? 1 : 0)
  )) {
    const shard = shards.reduce((best, next) => (next.durationMs < best.durationMs ? next : best))
    shard.files.push(file)
    shard.durationMs += weight(file)
  }
  for (const shard of shards) shard.files.sort()
  const plan = { schema: 1, identity, expected, shards }
  return { ...plan, digest: digest(plan) }
}

export function validatePlan(plan) {
  const { digest: seal, ...body } = plan
  if (
    plan.schema !== 1 ||
    typeof plan.identity !== 'string' ||
    !plan.identity ||
    seal !== digest(body)
  )
    throw new Error('Invalid shard plan seal')
  const expected = inventory(plan.expected)
  if (!same(expected, plan.expected) || !Array.isArray(plan.shards) || !plan.shards.length)
    throw new Error('Invalid shard plan')
  const all = []
  for (const shard of plan.shards) {
    if (
      !same(inventory(shard.files), shard.files) ||
      !Number.isFinite(shard.durationMs) ||
      shard.durationMs < 0
    )
      throw new Error('Invalid shard')
    all.push(...shard.files)
  }
  if (!same(inventory(all), expected))
    throw new Error('Shard union differs from expected inventory')
  return plan
}

export function selectShard(plan, expected, index, count) {
  validatePlan(plan)
  if (!same(inventory(expected), plan.expected)) throw new Error('Complete fast inventory changed')
  if (count !== plan.shards.length || !Number.isInteger(index) || index < 1 || index > count)
    throw new Error('Shard selection differs from plan')
  return plan.shards[index - 1].files
}

/** Parts must come from the harness's report + collection/error attestation validator.
 * A successful process exit alone is never an inventory or evidence of completion. */
export function mergeInventories(plan, parts) {
  validatePlan(plan)
  if (!Array.isArray(parts) || parts.length !== plan.shards.length)
    throw new Error('Missing shard completion')
  const indices = new Set()
  const files = []
  for (const part of parts) {
    const expected = selectShard(plan, plan.expected, part.index, parts.length)
    if (
      indices.has(part.index) ||
      part.planDigest !== plan.digest ||
      part.identity !== plan.identity ||
      part.rc !== 0
    )
      throw new Error('Failed, duplicate or mismatched shard')
    indices.add(part.index)
    const inv = part.inventory
    if (
      !inv ||
      inv.unhandled_errors !== 0 ||
      !same(inventory(inv.expected), expected) ||
      !Array.isArray(inv.files) ||
      !same(inventory(inv.files.map((f) => f.file)), expected)
    )
      throw new Error('Incomplete shard inventory')
    for (const file of inv.files) {
      if (
        !['passed', 'pending', 'skipped'].includes(file.status) ||
        !Array.isArray(file.tests) ||
        !file.tests.length ||
        file.tests.some(
          (t) =>
            typeof t.name !== 'string' ||
            !['passed', 'pending', 'skipped', 'todo'].includes(t.status)
        )
      )
        throw new Error('Failed or unknown test status')
      files.push(file)
    }
  }
  return {
    expected: plan.expected,
    files: files.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)),
    unhandled_errors: 0,
    shards: parts.map((part) => ({ index: part.index, planDigest: part.planDigest })),
    note: 'Vitest reports expected failures as passed; pending/skipped/todo retained verbatim',
  }
}

export function durationsFromReport(report, plugin) {
  const result = {}
  for (const item of report.testResults ?? []) {
    const file = relative(plugin, isAbsolute(item.name) ? item.name : resolve(plugin, item.name))
      .split(sep)
      .join('/')
    inventory([file])
    const duration = item.endTime - item.startTime
    if (!Number.isFinite(duration) || duration < 0 || Object.hasOwn(result, file))
      throw new Error('Invalid recorded module duration')
    result[file] = duration
  }
  return result
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, ...args] = process.argv.slice(2)
  const options = Object.fromEntries(
    args.map((arg) => {
      const match = /^--([a-z-]+)=(.+)$/.exec(arg)
      if (!match) throw new Error('Expected --option=value')
      return [match[1], match[2]]
    })
  )
  if (!options.output) throw new Error('Missing --output')
  const load = (path) => JSON.parse(readFileSync(path, 'utf8'))
  let result
  if (action === 'plan') {
    const expected = load(options.expected).map((entry) => {
      const name = typeof entry === 'string' ? entry : entry.file
      return isAbsolute(name) ? relative(options.plugin, name).split(sep).join('/') : name
    })
    const durations = options.durations ? load(options.durations) : {}
    result = makePlan(expected, durations, Number(options.count ?? 2), options.identity)
  } else if (action === 'merge') result = mergeInventories(load(options.plan), load(options.parts))
  else if (action === 'durations')
    result = durationsFromReport(load(options.report), options.plugin)
  else throw new Error('Expected plan, merge or durations')
  writeFileSync(`${options.output}.${process.pid}.tmp`, JSON.stringify(result, null, 2) + '\n')
  renameSync(`${options.output}.${process.pid}.tmp`, options.output)
  console.log(`Fast ${action} written: ${options.output}`)
}
