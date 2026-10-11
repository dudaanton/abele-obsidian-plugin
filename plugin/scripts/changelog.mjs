import { gitAt } from './changelog-git.mjs'
export { gitEnvironment } from './changelog-git.mjs'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { historical, overrides } from './changelog-history.mjs'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const version = (s) =>
  /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(s)?.slice(1).map(Number)
const compare = (a, b) => {
  const x = version(a),
    y = version(b)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}
const normalized = (s) => version(s)?.join('.')

export function subjectBullet(subject, override) {
  if (override === false) return null
  if (override) return [override.category, override.text]
  const match = /^(feat|fix|perf)(?:\([^)]*\))?!?:\s*(.+)$/i.exec(subject)
  if (!match || /^(?:bump|update)\s+(?:plugin\s+)?version\b/i.test(match[2])) return null
  const group = { feat: 'features', fix: 'fixes', perf: 'improvements' }[match[1].toLowerCase()]
  const text = match[2].trim().replace(/^\p{Ll}/u, (c) => c.toUpperCase())
  return text ? [group, text] : null
}

/** Full Git history is mandatory; never ship a truncated or silently empty catalog.
 * An explicit options.revision reads BOTH version metadata and history from that commit.
 * Default production generation still validates the working-tree release version. */
export function generateChangelog(root = project, options = {}) {
  const git = (...args) => gitAt(root, args)
  const fail = (message) => {
    throw new Error(`Changelog: ${message}`)
  }
  if (git('rev-parse', '--is-shallow-repository') === 'true')
    fail('shallow repository; fetch full history and tags')
  const head = git(
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${options.revision ?? 'HEAD'}^{commit}`
  )
  const committed = options.revision !== undefined
  const readMetadata = (path) =>
    JSON.parse(
      committed ? git('show', `${head}:${path}`) : readFileSync(resolve(root, path), 'utf8')
    )
  const target = readMetadata('manifest.json').version
  const hasPluginPackage = committed
    ? !!git('ls-tree', '-r', '--name-only', head, '--', 'plugin/package.json')
    : existsSync(resolve(root, 'plugin/package.json'))
  const packagePath = hasPluginPackage ? 'plugin/package.json' : 'package.json'
  const packageVersion = readMetadata(packagePath).version
  if (target !== packageVersion || !version(target))
    fail('manifest and package versions differ or are invalid')
  // Read the reachable DAG once. Parents preserve merge-base and range semantics, while
  // subjects and UTC dates no longer need one subprocess per release boundary.
  const graph = new Map(
    git('log', '--format=%H%x09%P%x09%cI%x09%ct%x09%s', head)
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [, revision, parents, date, timestamp, subject] =
          /^([^\t]+)\t([^\t]*)\t([^\t]+)\t(\d+)\t(.*)$/s.exec(line)
        return [
          revision,
          { revision, parents: parents ? parents.split(' ') : [], date, timestamp, subject },
        ]
      })
  )
  const resolved = new Map()
  const resolveRevision = (revision) => {
    if (graph.has(revision) || /^[a-f0-9]{40}$/.test(revision)) return revision
    if (resolved.has(revision)) return resolved.get(revision)
    let value = null
    try {
      value = git('rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`)
    } catch {
      /* Missing historical boundary. */
    }
    resolved.set(revision, value)
    return value
  }
  const isAncestor = (a, b) => {
    const ancestor = resolveRevision(a)
    const start = resolveRevision(b)
    if (!ancestor || !graph.has(ancestor) || !start) return false
    const pending = [start]
    const seen = new Set()
    while (pending.length) {
      const revision = pending.pop()
      if (revision === ancestor) return true
      if (seen.has(revision)) continue
      seen.add(revision)
      pending.push(...(graph.get(revision)?.parents ?? []))
    }
    return false
  }
  const tags = git('tag', '-l')
    .split('\n')
    .filter((name) => version(name) && compare(name, target) <= 0)
  const tagRevisions = tags.length
    ? git('rev-parse', ...tags.map((tag) => `refs/tags/${tag}^{commit}`)).split('\n')
    : []
  const entries = new Map()
  for (const [index, tag] of tags.entries()) {
    const revision = tagRevisions[index]
    if (!isAncestor(revision, head)) continue
    const key = normalized(tag)
    if (entries.has(key)) fail(`conflicting tag aliases for ${key}`)
    entries.set(key, { version: key, revision, dateSource: 'tag' })
  }
  for (const entry of options.historical ?? historical) {
    if (compare(entry.version, target) > 0) continue
    if (!isAncestor(entry.revision, head))
      fail(`missing or non-linear boundary ${entry.version}; fetch full history and tags`)
    if (entries.has(entry.version)) fail(`duplicate historical boundary ${entry.version}`)
    entries.set(entry.version, entry)
  }
  // The release script commits a version bump before attaching the lightweight tag. This
  // exact HEAD is the only untagged current version allowed to enter the catalog.
  if (!entries.has(target) && graph.get(head).subject === `chore: bump version to ${target}`) {
    if (
      JSON.parse(git('show', `${head}:manifest.json`)).version !== target ||
      JSON.parse(git('show', `${head}:${packagePath}`)).version !== target
    )
      fail('current version boundary is not committed')
    entries.set(target, { version: target, revision: head, dateSource: 'tag' })
  }
  if (!entries.has(target))
    fail(
      `current version ${target} has no release boundary; fetch missing tags or commit the release bump`
    )
  const bumps = []
  for (let revision = head; revision; revision = graph.get(revision)?.parents[0]) {
    const commit = graph.get(revision)
    bumps.push(`${revision}\t${commit.subject}`)
  }
  for (const line of bumps) {
    const match = /^([^\t]+)\tchore: bump version to (\d+\.\d+\.\d+)$/.exec(line)
    if (!match || compare(match[2], target) > 0) continue
    if (!entries.has(match[2])) fail(`missing tag for ${match[2]}; fetch full history and tags`)
  }
  const ordered = [...entries.values()].sort((a, b) => compare(a.version, b.version))
  if (!ordered.length || (!ordered.some((entry) => entry.version === target) && tags.length === 0))
    fail('missing history/tags; fetch full history and tags')
  for (let i = 1; i < ordered.length; i++) {
    if (
      !isAncestor(ordered[i - 1].revision, ordered[i].revision) ||
      ordered[i - 1].revision === ordered[i].revision
    )
      fail(`non-linear release boundary ${ordered[i].version}`)
  }
  const changes = options.overrides ?? overrides
  const unrecognized = []
  // Ordered boundaries are linear: the accumulated reachable set is precisely what Git
  // excludes in previous..current, including all side-branch ancestors of older merges.
  const included = new Set()
  const releases = ordered
    .map((entry) => {
      const revision = resolveRevision(entry.revision)
      const utcDate = entry.date ?? new Date(graph.get(revision).date).toISOString().slice(0, 10)
      const result = {
        version: entry.version,
        date: utcDate,
        ...(entry.dateSource === 'history' ? { dateSource: 'history' } : {}),
        features: [],
        fixes: [],
        improvements: [],
      }
      const commits = []
      const pending = [revision]
      while (pending.length) {
        const hash = pending.pop()
        if (included.has(hash)) continue
        included.add(hash)
        const commit = graph.get(hash)
        pending.push(...commit.parents)
        if (commit.parents.length < 2)
          commits.push(`${commit.timestamp}\t${hash}\t${commit.subject}`)
      }
      commits.sort(
        (a, b) =>
          Number(a.split('\t')[0]) - Number(b.split('\t')[0]) || (a < b ? -1 : a > b ? 1 : 0)
      )
      for (const line of commits) {
        const [, hash, subject] = /^(\d+)\t([^\t]+)\t(.*)$/s.exec(line).slice(1)
        const bullet = subjectBullet(subject, changes[hash])
        if (!bullet) {
          if (
            !(hash in changes) &&
            !/^(?:feat|fix|perf|test|chore|ci|build|docs|refactor|style|wip)(?:\([^)]*\))?!?:/i.test(
              subject
            )
          )
            unrecognized.push({ revision: hash, subject })
          continue
        }
        const [category, text] = bullet
        if (!result[category].includes(text)) result[category].push(text)
      }
      return result
    })
    .reverse()
  options.onUnrecognized?.(unrecognized)
  return releases
}
