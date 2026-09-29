import { gitAt } from './changelog-git.mjs'
export { gitEnvironment } from './changelog-git.mjs'
import { readFileSync } from 'node:fs'
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

/** Full Git history is mandatory; never ship a truncated or silently empty catalog. */
export function generateChangelog(root = project, options = {}) {
  const git = (...args) => gitAt(root, args)
  const fail = (message) => {
    throw new Error(`Changelog: ${message}`)
  }
  if (git('rev-parse', '--is-shallow-repository') === 'true')
    fail('shallow repository; fetch full history and tags')
  const target = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8')).version
  const packageVersion = JSON.parse(
    readFileSync(resolve(root, root === project ? 'plugin/package.json' : 'package.json'), 'utf8')
  ).version
  if (target !== packageVersion || !version(target))
    fail('manifest and package versions differ or are invalid')
  const head = git('rev-parse', 'HEAD')
  const isAncestor = (a, b) => {
    try {
      git('merge-base', '--is-ancestor', a, b)
      return true
    } catch {
      return false
    }
  }
  const tags = git('tag', '-l')
    .split('\n')
    .filter((name) => version(name) && compare(name, target) <= 0)
  const entries = new Map()
  for (const tag of tags) {
    const revision = git('rev-parse', `${tag}^{commit}`)
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
  if (
    !entries.has(target) &&
    /^chore: bump version to /.test(git('show', '-s', '--format=%s', head)) &&
    git('show', '-s', '--format=%s', head) === `chore: bump version to ${target}`
  ) {
    entries.set(target, { version: target, revision: head, dateSource: 'tag' })
  }
  const bumps = git('log', '--first-parent', '--format=%H%x09%s', head).split('\n')
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
  return ordered
    .map((entry, i) => {
      const utcDate =
        entry.date ??
        new Date(git('show', '-s', '--format=%cI', entry.revision)).toISOString().slice(0, 10)
      const result = {
        version: entry.version,
        date: utcDate,
        ...(entry.dateSource === 'history' ? { dateSource: 'history' } : {}),
        features: [],
        fixes: [],
        improvements: [],
      }
      const range = i ? `${ordered[i - 1].revision}..${entry.revision}` : entry.revision
      const commits = git('log', '--no-merges', '--reverse', '--format=%H%x09%s', range)
        .split('\n')
        .filter(Boolean)
      for (const line of commits) {
        const [hash, subject] = line.split(/\t(.*)/s)
        const bullet = subjectBullet(subject, changes[hash])
        if (!bullet) continue
        const [category, text] = bullet
        if (!result[category].includes(text)) result[category].push(text)
      }
      return result
    })
    .reverse()
}
