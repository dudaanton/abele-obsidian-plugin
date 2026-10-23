import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:net'
import { randomBytes, createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { verifySyncFixture } from '../../scripts/sync-server-fixture.mjs'
import { SERVER_TEST_COMMIT } from '../../scripts/server-test-fixtures.mjs'
const exec = promisify(execFile)
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

export function verifyServerLimits(actual, expected) {
  if (!expected || !Number.isSafeInteger(expected.max_file_bytes))
    throw new Error('Expected server limits must be recorded explicitly')
  for (const key of ['max_file_bytes', 'quota_bytes'])
    if (actual[key] !== expected[key])
      throw new Error('Advertised server limit differs from selected stand')
}

export async function openServer(config) {
  if ((config.serverMode ?? 'remote') === 'remote')
    return {
      address: config.server,
      token: (await readFile(config.tokenFile, 'utf8')).trim(),
      receipt: { mode: 'remote', address: config.server, version: config.serverVersion ?? null },
      close: async () => {},
    }
  if (config.serverMode !== 'local') throw new Error('Unknown server mode')
  const fixture = verifySyncFixture(config.serverFixture)
  const directory = resolve(config.localServerDirectory)
  await mkdir(directory, { recursive: true })
  if ((await readdir(directory)).length) throw new Error('Local server storage must be empty')
  const { version } = JSON.parse(
    await readFile(join(fixture, 'packages/server/package.json'), 'utf8')
  )
  const probe = createServer()
  await new Promise((done, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', done)
  })
  const port = probe.address().port
  await new Promise((done) => probe.close(done))
  const address = `http://127.0.0.1:${port}`
  // Inherited stand/database/fixture variables must never redirect this owned instance.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('ABELE_'))
  )
  Object.assign(env, {
    ABELE_DATABASE_URL: `sqlite://${join(directory, 'abele.db')}`,
    ABELE_BLOB_DIR: join(directory, 'blobs'),
    ABELE_MASTER_KEY: randomBytes(32).toString('hex'),
    ABELE_TOKEN_PEPPER: randomBytes(16).toString('hex'),
    ABELE_PORT: String(port),
    ABELE_HOST: '127.0.0.1',
  })
  const child = spawn(process.execPath, [join(fixture, 'packages/server/dist/index.js')], {
    env,
    stdio: 'ignore',
  })
  let spawnFailed = false
  child.on('error', () => {
    spawnFailed = true
  })
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    if (child.exitCode === null && child.signalCode === null && !spawnFailed) {
      const ended = new Promise((done) => child.once('exit', done))
      child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000)
      try {
        await ended
      } finally {
        clearTimeout(timer)
      }
    }
    await rm(directory, { recursive: true, force: true })
  }
  try {
    const until = Date.now() + 30000
    let ready = false
    while (Date.now() < until && !spawnFailed && child.exitCode === null) {
      try {
        ready = (
          await globalThis.fetch(address + '/healthz', { signal: AbortSignal.timeout(1000) })
        ).ok
      } catch {
        /* not listening yet */
      }
      if (ready) break
      await delay(100)
    }
    if (!ready) throw new Error('Local fixture server did not become ready')
    const { stdout } = await exec(
      process.execPath,
      [
        join(fixture, 'packages/server/dist/admin-cli/index.js'),
        'user',
        'create',
        '--label',
        'Synthetic scale user',
        '--address',
        address,
      ],
      { env, timeout: 45000, killSignal: 'SIGKILL' }
    )
    if (!stdout.trim()) throw new Error('Local fixture provisioning failed')
    return {
      address,
      token: stdout.trim(),
      close,
      receipt: {
        mode: 'local',
        implementation: 'pinned-server-test-fixture',
        fixtureReceiptSha256: createHash('sha256')
          .update(await readFile(join(fixture, '.abele-sync-fixture.json')))
          .digest('hex'),
        revision: SERVER_TEST_COMMIT,
        version,
        database: 'sqlite',
        bind: '127.0.0.1',
        address,
        fixture,
        storage: directory,
        node: process.version,
      },
    }
  } catch {
    await close()
    // Child/admin errors can include credentials. Do not forward their stdout or environment.
    throw new Error('Local fixture startup failed; no server left running')
  }
}
