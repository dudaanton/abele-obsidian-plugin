#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, readdir, realpath, lstat, readlink } from 'node:fs/promises'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)
const digest = (bytes, algorithm = 'sha256', encoding = 'hex') =>
  createHash(algorithm).update(bytes).digest(encoding)
const json = async (path) => JSON.parse(await readFile(path, 'utf8'))
const options = (cwd) => ({ cwd, maxBuffer: 32 * 1024 ** 2 })

async function loggedExec(command, args, opts) {
  try {
    const result = await exec(command, args, opts)
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    return result
  } catch (error) {
    if (error.stdout) process.stdout.write(error.stdout)
    if (error.stderr) process.stderr.write(error.stderr)
    throw error
  }
}

async function payload(root, prefix = '') {
  const files = {}
  for (const entry of (await readdir(join(root, prefix), { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) {
      const target = await realpath(join(root, path))
      if (!path.startsWith('node_modules/.bin/') || !target.startsWith(resolve(root) + '/'))
        throw new Error('Linked SDK payload refused')
      files[path] = `link:${await readlink(join(root, path))}:${digest(await readFile(target))}`
      continue
    }
    if (entry.isDirectory()) Object.assign(files, await payload(root, path))
    else files[path] = digest(await readFile(join(root, path)))
  }
  return files
}

/** The override lives only in a disposable export. Production release pin checks stay intact. */
export async function installSdkTarball(pluginRoot, input, execute = exec, npmOptions = {}) {
  if (!/^[a-f0-9]{64}$/i.test(input.sha256 ?? ''))
    throw new Error('SDK checksum must be a SHA-256 hex digest')
  const path = await realpath(input.path)
  const bytes = await readFile(path)
  const sha256 = digest(bytes)
  if (sha256 !== input.sha256.toLowerCase()) throw new Error('SDK tarball checksum mismatch')
  const root = await realpath(pluginRoot)
  const directory = join(root, '.scratch/scale-sdk', randomUUID())
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const stagedPath = join(directory, 'sdk.tgz')
  await writeFile(stagedPath, bytes, { mode: 0o600, flag: 'wx' })
  const integrity = `sha512-${digest(bytes, 'sha512', 'base64')}`
  await execute(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--save-exact',
      '--cache',
      npmOptions.cache ?? join(root, '.scratch/npm-cache'),
      ...(npmOptions.offline ? ['--offline'] : []),
      './' + relative(root, stagedPath),
    ],
    options(root)
  )
  const installed = join(root, 'node_modules/@abele/sync-sdk')
  const manifest = await json(join(installed, 'package.json'))
  if (manifest.name !== '@abele/sync-sdk') throw new Error('Installed SDK package name mismatch')
  const lock = await json(join(root, 'package-lock.json'))
  const locked = lock.packages?.['node_modules/@abele/sync-sdk']
  if (
    locked?.version !== manifest.version ||
    locked.integrity !== integrity ||
    !locked.resolved?.startsWith('file:') ||
    locked.link
  )
    throw new Error('Installed SDK archive provenance mismatch')
  const sdk = {
    kind: 'tarball',
    path,
    stagedPath,
    sha256,
    integrity,
    version: manifest.version,
    resolved: locked.resolved,
    spec: (await json(join(root, 'package.json'))).dependencies?.['@abele/sync-sdk'],
    payload: await payload(installed),
    manifestSha256: digest(await readFile(join(root, 'package.json'))),
    lockSha256: digest(await readFile(join(root, 'package-lock.json'))),
  }
  await verifyPreparedSdk(root, sdk)
  return sdk
}

export async function verifyPreparedSdk(root, sdk) {
  if (sdk?.kind !== 'tarball') return
  if (digest(await readFile(sdk.stagedPath)) !== sdk.sha256)
    throw new Error('SDK staged archive checksum changed')
  const installed = join(root, 'node_modules/@abele/sync-sdk')
  if (
    (await lstat(installed)).isSymbolicLink() ||
    (await realpath(installed)) !== resolve(installed)
  )
    throw new Error('Linked SDK package refused')
  const manifest = await json(join(installed, 'package.json'))
  if (
    manifest.name !== '@abele/sync-sdk' ||
    manifest.version !== sdk.version ||
    JSON.stringify(await payload(installed)) !== JSON.stringify(sdk.payload)
  )
    throw new Error('Installed SDK payload changed')
  const lock = await json(join(root, 'package-lock.json'))
  const locked = lock.packages?.['node_modules/@abele/sync-sdk']
  if (
    locked?.integrity !== sdk.integrity ||
    locked.resolved !== sdk.resolved ||
    locked.version !== sdk.version ||
    digest(await readFile(join(root, 'package.json'))) !== sdk.manifestSha256 ||
    digest(await readFile(join(root, 'package-lock.json'))) !== sdk.lockSha256
  )
    throw new Error('SDK dependency metadata changed')
}

export async function recordBuildReceipt(config, sdk, artifact) {
  if (artifact.provenance?.git?.revision !== config.build)
    throw new Error('Build receipt plugin revision mismatch')
  await verifyPreparedSdk(config.pluginRoot, sdk)
  const receipt = {
    schema: 1,
    revision: config.build,
    sdk,
    buildManifestSha256: digest(Buffer.from(JSON.stringify(artifact))),
    artifact,
  }
  await mkdir(config.output, { recursive: true })
  await writeFile(join(config.output, 'build-receipt.json'), JSON.stringify(receipt, null, 2))
  return receipt
}

export function validateBuildReceipt(receipt, artifact, revision, sdkTarball) {
  if (
    receipt.schema !== 1 ||
    receipt.revision !== revision ||
    artifact.provenance?.git?.revision !== revision
  )
    throw new Error('Selected build receipt revision mismatch')
  if (receipt.buildManifestSha256 !== digest(Buffer.from(JSON.stringify(artifact))))
    throw new Error('Selected build receipt manifest mismatch')
  if (
    sdkTarball &&
    (receipt.sdk?.kind !== 'tarball' || receipt.sdk.sha256 !== sdkTarball.sha256?.toLowerCase())
  )
    throw new Error('Selected build SDK tarball mismatch')
}

export async function buildCandidate(config, execute = loggedExec) {
  if (!/^[a-f0-9]{40}$/.test(config.build ?? ''))
    throw new Error('A resolved plugin commit is required')
  const root = await realpath(config.pluginRoot)
  const repository = dirname(root)
  const run = (command, args) => execute(command, args, options(root))
  const git = async (args) =>
    (
      await execute('git', ['-c', 'core.fsmonitor=false', '-C', repository, ...args], options(root))
    ).stdout.trim()
  if ((await git(['rev-parse', 'HEAD'])) !== config.build || (await git(['status', '--porcelain'])))
    throw new Error('Clean candidate export at the selected commit required')
  let branch = false
  try {
    await git(['symbolic-ref', '-q', 'HEAD'])
    branch = true
  } catch (error) {
    if (error.code !== 1) throw error
  }
  if (branch) throw new Error('Candidate export must be detached')
  const cache = config.npmCache ?? join(repository, '.scratch/npm-cache')
  let sdk
  if (config.sdkTarball) {
    sdk = await installSdkTarball(root, config.sdkTarball, execute, {
      cache,
      offline: config.offline,
    })
    // Release-pin verification is registry-only. The explicit dev build verifies the exact
    // archive instead, while keeping the same type receipt and artifact checks.
    await run(process.execPath, ['scripts/checked-build.mjs', 'types'])
    const types =
      "import {resolve} from 'node:path'; import {requireTypes} from './scripts/build-inputs.mjs'; requireTypes(resolve('..'))"
    await run(process.execPath, ['--input-type=module', '-e', types])
    await verifyPreparedSdk(root, sdk)
    await run(process.execPath, [
      'node_modules/vite/bin/vite.js',
      'build',
      '--mode',
      'sharing-test',
    ])
    await run(process.execPath, ['--input-type=module', '-e', types])
  } else {
    await run('npm', [
      'ci',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--cache',
      cache,
      ...(config.offline ? ['--offline'] : []),
    ])
    await run('npm', ['run', 'build:test'])
    const pin = await json(join(root, 'scripts/sync-sdk-inputs.json'))
    sdk = { kind: 'registry', version: pin.version, integrity: pin.integrity }
  }
  const changes = await git(['diff', '--name-only'])
  if (
    changes
      .split('\n')
      .some((path) => path && !['plugin/package.json', 'plugin/package-lock.json'].includes(path))
  )
    throw new Error('Unexpected candidate source changes')
  await run(process.execPath, ['scripts/build-artifact.mjs', 'build', 'sharing-test'])
  const artifact = await json(join(root, 'build/build-manifest.json'))
  const receipt = await recordBuildReceipt({ ...config, pluginRoot: root }, sdk, artifact)
  receipt.sourceChanges = changes ? changes.split('\n') : []
  await writeFile(join(config.output, 'build-receipt.json'), JSON.stringify(receipt, null, 2))
  return receipt
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const receipt = await buildCandidate(await json(process.argv[2]))
  console.log(
    `Scale build ready: ${receipt.revision}, SDK ${receipt.sdk.version} (${receipt.sdk.kind})`
  )
}
