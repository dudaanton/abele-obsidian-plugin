import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  statSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { gitAt } from './changelog-git.mjs'

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** Content identity works in clean checkouts and also fails closed for working-tree edits.
 * Generated output and installed dependencies have their own identities, never source names. */
export function sourceIdentity(root) {
  const names = gitAt(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter(Boolean)
    .filter((name) => !/^(?:\.scratch\/|plugin\/(?:build|node_modules)\/)/.test(name))
  const hash = createHash('sha256')
  for (const name of [...new Set(names)].sort()) {
    const file = resolve(root, name)
    hash.update(`${name}\0`)
    if (!existsSync(file)) {
      hash.update('missing\0')
      continue
    }
    const stat = lstatSync(file)
    hash.update(`${stat.mode & 0o111}\0`)
    if (stat.isSymbolicLink()) hash.update(`${readlinkSync(file)}\0`)
    hash.update(sha256(readFileSync(file)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

/** Lock metadata alone cannot detect an edited declaration or compiler. Hash installed
 * type sources, package resolution metadata and the compiler's own payload as well.
 * Generated runner/build caches are not dependency inputs. */
function installedTypeInputs(root) {
  const hash = createHash('sha256')
  const active = new Set()
  const cacheNames = new Set(['.cache', '.vite', '.vite-temp', '.bin'])
  const walk = (directory, relative = '') => {
    const actual = realpathSync(directory)
    if (active.has(actual))
      throw new Error('Cyclic installed dependency link; type identity unknown')
    active.add(actual)
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    )) {
      if (basename(directory) === 'node_modules' && cacheNames.has(entry.name)) continue
      const file = resolve(directory, entry.name)
      const name = relative ? `${relative}/${entry.name}` : entry.name
      const stat = entry.isSymbolicLink() ? statSync(file) : entry
      if (entry.isSymbolicLink()) hash.update(`${name}\0link\0${readlinkSync(file)}\0`)
      if (stat.isDirectory()) walk(file, name)
      else if (/\.[cm]?ts$|\.json$/i.test(name) || /(?:^|\/)typescript\//.test(name))
        hash.update(`${name}\0${sha256(readFileSync(file))}\0`)
    }
    active.delete(actual)
  }
  walk(resolve(root, 'plugin/node_modules'))
  return hash.digest('hex')
}

export function inputIdentity(root) {
  const installed = resolve(root, 'plugin/node_modules/.package-lock.json')
  if (!existsSync(installed)) throw new Error('Install dependencies before checking or building')
  return {
    source: sourceIdentity(root),
    dependencies: sha256(readFileSync(installed)),
    typeInputs: installedTypeInputs(root),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  }
}

export function historyIdentity(root) {
  const tagRefs = gitAt(root, [
    'for-each-ref',
    '--format=%(refname)%09%(objectname)%09%(*objectname)',
    'refs/tags',
  ])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref, object, peeled = ''] = line.split('\t')
      return { ref, object, peeled }
    })
  return {
    revision: gitAt(root, ['rev-parse', 'HEAD']),
    tree: gitAt(root, ['rev-parse', 'HEAD^{tree}']),
    history: sha256(gitAt(root, ['log', '--format=%H %P %ct %s', 'HEAD'])),
    tags: sha256(JSON.stringify(tagRefs)),
    tagRefs,
  }
}

const receiptPath = (root) => resolve(root, 'plugin/node_modules/.cache/abele/types.json')
export function atomicJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n')
  renameSync(temporary, file)
}
export function invalidateTypes(root) {
  rmSync(receiptPath(root), { force: true })
}
export function recordTypes(root, before) {
  if (JSON.stringify(before) !== JSON.stringify(inputIdentity(root)))
    throw new Error('Type-check inputs changed during verification')
  atomicJson(receiptPath(root), { schema: 1, passes: ['normal', 'strict-null'], inputs: before })
}
export function requireTypes(root) {
  let receipt
  try {
    receipt = JSON.parse(readFileSync(receiptPath(root), 'utf8'))
  } catch {
    throw new Error('Build-only requires a matching successful npm run types')
  }
  if (
    receipt.schema !== 1 ||
    JSON.stringify(receipt.passes) !== '["normal","strict-null"]' ||
    JSON.stringify(receipt.inputs) !== JSON.stringify(inputIdentity(root))
  )
    throw new Error('Build-only requires a matching successful npm run types')
}
