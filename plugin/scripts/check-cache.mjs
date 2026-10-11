import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'

const sha = (value) => createHash('sha256').update(value).digest('hex')
const key = (value) => sha(JSON.stringify(value))
const toolchain = () => ({ node: process.version, platform: process.platform, arch: process.arch })

/** Includes executable rule/compiler code, not just lock metadata or declarations.
 * Mutable runner output is excluded; symlink cycles fail closed. */
export function dependencyIdentity(root) {
  const hash = createHash('sha256')
  const active = new Set()
  const walk = (directory, prefix = '') => {
    const actual = realpathSync(directory)
    if (active.has(actual)) throw new Error('Cyclic installed dependency link')
    active.add(actual)
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name, 'en')
    )) {
      if (
        basename(directory) === 'node_modules' &&
        ['.cache', '.vite', '.vite-temp', '.bin'].includes(entry.name)
      )
        continue
      const file = resolve(directory, entry.name)
      const name = `${prefix}/${entry.name}`
      const stat = statSync(file)
      if (entry.isSymbolicLink()) hash.update(`${name}\0link\0${readlinkSync(file)}\0`)
      if (stat.isDirectory()) walk(file, name)
      else hash.update(`${name}\0${sha(readFileSync(file))}\0`)
    }
    active.delete(actual)
  }
  walk(resolve(root, 'plugin/node_modules'))
  return hash.digest('hex')
}

function repositoryIdentity(root, configurationOnly = false) {
  const hash = createHash('sha256')
  const active = new Set()
  const walk = (directory, prefix = '') => {
    const actual = realpathSync(directory)
    if (active.has(actual)) throw new Error('Cyclic repository input link')
    active.add(actual)
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name, 'en')
    )) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name
      // Git ignores are not compiler/linter ignores: imported generated sources count too.
      if (
        /^(?:\.git|\.scratch|plugin\/(?:build|dist|coverage|node_modules))(?:\/|$)/.test(name) ||
        name === 'plugin/main.js'
      )
        continue
      const file = resolve(directory, entry.name)
      const stat = statSync(file)
      if (stat.isDirectory()) walk(file, name)
      else {
        // Nested formatter/configuration files remain inputs beside content-cached code.
        if (
          configurationOnly &&
          /^plugin\/(?:src|tests)\//.test(name) &&
          /\.(?:[cm]?[jt]sx?|vue)$/.test(name) &&
          !/(?:config|rc|ignore|package\.json)/i.test(basename(name))
        )
          continue
        hash.update(`${name}\0`)
        if (entry.isSymbolicLink()) hash.update(`${readlinkSync(file)}\0`)
        hash.update(`${sha(readFileSync(file))}\0`)
      }
    }
    active.delete(actual)
  }
  walk(root)
  return hash.digest('hex')
}
const configurationIdentity = (root) => repositoryIdentity(root, true)

export function compilerCacheKey(root, program, options, dependencies = dependencyIdentity(root)) {
  // TypeScript validates the source contents itself on every incremental run. Absolute root
  // and parsed options bind referenced/extended configs and resolution to the same program.
  return key({
    schema: 1,
    root: realpathSync(root),
    program,
    options,
    configuration: configurationIdentity(root),
    dependencies,
    toolchain: toolchain(),
  })
}

function programInputIdentity(root) {
  // Read the resolved program closure too: imports/extended configs may live outside the
  // checkout or in otherwise generated directories. Constructing the graph does not run a
  // semantic check, but binds every read source, declaration, config and resolution manifest.
  const ts = createRequire(import.meta.url)('typescript')
  const reads = new Map()
  const readFile = (file) => {
    const contents = ts.sys.readFile(file)
    reads.set(resolve(file), contents === undefined ? 'missing' : sha(contents))
    return contents
  }
  const plugin = resolve(root, 'plugin')
  const configPath = resolve(plugin, 'tsconfig.json')
  const config = ts.readConfigFile(configPath, readFile)
  const parsed = ts.parseJsonConfigFileContent(
    config.config ?? {},
    { ...ts.sys, readFile },
    plugin,
    {},
    configPath
  )
  const host = ts.createCompilerHost(parsed.options)
  host.readFile = readFile
  ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    projectReferences: parsed.projectReferences,
    host,
  })
  return key([...reads].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

export function lintCacheKeys(root) {
  const common = {
    schema: 1,
    root: realpathSync(root),
    configuration: configurationIdentity(root),
    dependencies: dependencyIdentity(root),
    toolchain: toolchain(),
    environment: Object.fromEntries(
      Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b, 'en'))
    ),
  }
  return {
    untyped: key(common),
    typed: key({
      ...common,
      source: repositoryIdentity(root),
      program: programInputIdentity(root),
    }),
  }
}

/** Opt-in external caches. Contention is a cold run, never an age-based unlock.
 * Only sealed output from successful invocations can seed a run. Interrupted/corrupt caches
 * miss. Working files share the cache directory, preserving build-info relative filenames. */
export function cacheEntry(root, stage, identity, env = process.env) {
  if (env.ABELE_CHECK_COLD === '1' || !env.ABELE_CHECK_CACHE_DIR) return null
  if (!/^[a-z0-9-]+$/.test(stage) || !/^[a-z0-9-]+$/.test(identity))
    throw new Error('Invalid cache key')
  if (!isAbsolute(env.ABELE_CHECK_CACHE_DIR))
    throw new Error('Check cache directory must be absolute')
  mkdirSync(env.ABELE_CHECK_CACHE_DIR, { recursive: true })
  const cacheRoot = realpathSync(env.ABELE_CHECK_CACHE_DIR)
  const checkout = realpathSync(root)
  const fromRoot = relative(checkout, cacheRoot)
  if (!fromRoot || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot)))
    throw new Error('Check caches must live outside the checkout')
  const directory = resolve(cacheRoot, stage, identity)
  mkdirSync(directory, { recursive: true })
  const lock = resolve(directory, 'lock')
  try {
    mkdirSync(lock)
  } catch (error) {
    if (error.code === 'EEXIST') return null
    throw error
  }
  const stored = resolve(directory, 'data')
  const seal = resolve(directory, 'seal.json')
  const path = resolve(directory, `working-${process.pid}`)
  try {
    try {
      const previous = JSON.parse(readFileSync(seal, 'utf8'))
      if (previous.identity === identity && previous.sha256 === sha(readFileSync(stored)))
        copyFileSync(stored, path)
    } catch {
      /* Unknown/corrupt cache is a cold run. */
    }
    let released = false
    return {
      path,
      release(success = false) {
        if (released) return
        released = true
        try {
          if (success && existsSync(path)) {
            const checksum = sha(readFileSync(path))
            renameSync(path, stored)
            writeFileSync(
              `${seal}.${process.pid}.tmp`,
              JSON.stringify({ identity, sha256: checksum })
            )
            renameSync(`${seal}.${process.pid}.tmp`, seal)
          }
        } finally {
          rmSync(path, { force: true })
          rmSync(lock, { recursive: true })
        }
      },
    }
  } catch (error) {
    rmSync(lock, { recursive: true })
    throw error
  }
}
