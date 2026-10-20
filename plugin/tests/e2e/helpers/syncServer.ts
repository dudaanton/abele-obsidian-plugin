import { AccessClient } from '@abele/sync-sdk/core'
import { decodeAccessToken } from '@abele/sync-sdk/protocol'
import { fixtureTlsFetch, syncFixtureTls } from './syncFixtureTls'
export const fixtureFetch: typeof fetch = (input, init) =>
  String(input instanceof Request ? input.url : input).startsWith('https:')
    ? fixtureTlsFetch(input, init)
    : globalThis.fetch(input, { ...init, redirect: 'manual' })
/** Pinned real server, isolated storage and CLI-provisioned root tokens. */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'
import { existsSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { verifySyncFixture } from '../../../scripts/sync-server-fixture.mjs'
import { locateSyncRepository } from '../../../scripts/sync-repository.mjs'

/** Missing or unbuilt pinned fixture is a setup failure. */
export class SiblingUnavailableError extends Error {}

/**
 * Only the explicit clean-archive ABELE_SYNC_DIR fixture; its provenance must match the
 * pinned plugin packages. Missing input is a failure, not sibling resolution or a skip.
 */
export const siblingRepositoryPath = locateSyncRepository()
const SIBLING = process.env.ABELE_SYNC_DIR ? resolved(process.env.ABELE_SYNC_DIR) : ''
/**
 * The path with its links followed. In a worktree the sibling is reached through a symlink, and
 * the admin CLI runs only when the script it was started as is the file it is — a check that
 * compares the path as given with the path as loaded, so through the link it did nothing and
 * exited 0 without provisioning a user.
 */
function resolved(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

const SERVER = join(SIBLING, 'packages/server/dist/index.js')
const ADMIN = join(SIBLING, 'packages/server/dist/admin-cli/index.js')

/** How long the server has to answer `/healthz` before the suite gives up on it. */
const READY_MS = 30_000
/**
 * Admin provisioning keeps the tier's per-call ceiling: a blocked process cannot report progress.
 */
const ADMIN_MS = 45_000

export interface SyncServer {
  /** Advertised endpoint; LAN reachable in the phone tier. */
  url: string
  /** Provisioned locally with user create; never logged. */
  rootToken: string
  suspend(): void
  resume(): void
  /** Reject in-flight requests without thawing them during graceful shutdown. */
  crash(): Promise<void>
  issue(scope: { kind: 'folder' | 'group'; id: string }, label?: string): Promise<string>
  /** Safe to call twice; takes the database and the blobs with it. */
  kill(): Promise<void>
}

/** Whether the sibling is there and built. Nothing here works without it. */
export function siblingBuilt(): boolean {
  return existsSync(SERVER) && existsSync(ADMIN)
}

/** Where the sibling was looked for. */
export const siblingPath = SIBLING

/** Why the sibling cannot be used, in words that say what to do about it; null when it can. */
export function siblingMissing(): string | null {
  if (!SIBLING)
    throw new Error(
      `ABELE_SYNC_DIR must name a pinned clean-archive fixture. Prepare it with npm run test:server -- ${siblingRepositoryPath}`
    )
  verifySyncFixture(SIBLING)
  if (!siblingBuilt())
    throw new SiblingUnavailableError('the explicit sync fixture has no built server and admin CLI')
  return null
}

/**
 * A server on a free port, with a database and a blob directory of its own under `dir`.
 *
 * The caller owns `dir` — the suite puts it inside its isolated fixture directory so cleanup takes
 * everything — and `kill` removes what the server wrote inside it.
 */
export async function spawnSyncServer(dir: string): Promise<SyncServer> {
  verifySyncFixture(SIBLING)
  if (!siblingBuilt()) {
    throw new SiblingUnavailableError(`${SIBLING} has no built server or admin CLI`)
  }
  const port = await freePort()
  const frozen = join(dir, 'frozen')
  const network = syncFixtureNetwork(port),
    backend = `http://127.0.0.1:${port}`,
    tls = network.phoneHost ? await syncFixtureTls(backend, network.phoneHost) : null
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ABELE_DATABASE_URL: `sqlite://${join(dir, 'abele.db')}`,
    ABELE_BLOB_DIR: join(dir, 'blobs'),
    ABELE_MASTER_KEY: randomBytes(32).toString('hex'),
    ABELE_TOKEN_PEPPER: randomBytes(16).toString('hex'),
    ABELE_PORT: String(port),
    ABELE_HOST: '127.0.0.1',
    ABELE_FIXTURE_HTTP_TRACE: '1',
    ABELE_FIXTURE_FREEZE_FILE: frozen,
  }

  const child = spawn(
    process.execPath,
    ['--import', join(__dirname, 'syncFixtureHttpTrace.mjs'), SERVER],
    { env, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  // Held rather than printed: a suite that passes says nothing, and one that does not gets
  // the server's own words in the failure.
  const said: string[] = []
  child.stdout?.on('data', (chunk: Buffer) => said.push(chunk.toString()))
  if (child.stdout)
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (line.startsWith('[sync-fixture-http] ')) console.debug(line)
    })
  child.stderr?.on('data', (chunk: Buffer) => said.push(chunk.toString()))

  const url = tls?.url ?? network.url
  let killed = false
  const kill = async (): Promise<void> => {
    if (!killed) {
      killed = true
      rmSync(frozen, { force: true })
      child.kill('SIGTERM')
      await ended(child)
      await tls?.close()
    }
    await rm(join(dir, 'blobs'), { recursive: true, force: true })
    for (const suffix of ['', '-wal', '-shm']) {
      await rm(`${join(dir, 'abele.db')}${suffix}`, { force: true })
    }
  }

  try {
    await ready(backend, child, said)
    if (tls && !(await fixtureFetch(tls.url + '/healthz')).ok)
      throw new Error('Phone fixture TLS front end is unavailable')
  } catch (error) {
    await kill()
    throw error
  }

  const done = spawnSync(
    process.execPath,
    [ADMIN, 'user', 'create', '--label', 'Sample user', '--address', url],
    { env, encoding: 'utf8', timeout: ADMIN_MS, killSignal: 'SIGKILL' }
  )
  if (done.status !== 0) {
    await kill()
    throw new Error('Token provisioning failed')
  }
  const rootToken = done.stdout.trim()
  try {
    decodeAccessToken(rootToken)
  } catch {
    await kill()
    throw new Error('Token provisioning returned no valid token')
  }
  return {
    url,
    kill,
    crash: async () => {
      child.kill('SIGKILL')
      await ended(child)
      await kill()
    },
    rootToken,
    suspend: () => {
      writeFileSync(frozen, '')
      child.kill('SIGSTOP')
    },
    resume: () => {
      rmSync(frozen, { force: true })
      child.kill('SIGCONT')
    },
    issue: async (scope, label = 'Sample shared access') =>
      (await AccessClient.fromToken(rootToken, { fetch: fixtureFetch }).issue({ scope, label }))
        .token,
  }
}

/** Sync uses a direct LAN endpoint on a separate phone, not a driver reverse tunnel.
 * Require an explicit reachable Mac hostname/address rather than guessing an interface. */
export function syncFixtureNetwork(
  port: number,
  env = process.env
): { url: string; phoneHost?: string } {
  if (env.E2E_TARGET !== 'phone') return { url: `http://127.0.0.1:${port}` }
  const host = env.ABELE_SYNC_PHONE_HOST?.trim()
  if (!host) return { url: `http://127.0.0.1:${port}` }
  if (/[\s?#@]/.test(host) || host.includes('/') || host.includes('\\'))
    throw new Error(
      'ABELE_SYNC_PHONE_HOST must name this machine’s LAN hostname or address (without scheme or port)'
    )
  let url: URL
  try {
    url = new URL(`https://${host}:${port}`)
  } catch {
    throw new Error('ABELE_SYNC_PHONE_HOST is not a valid LAN hostname or address')
  }
  if (
    url.port !== String(port) ||
    url.hostname === 'localhost' ||
    /^127\./.test(url.hostname) ||
    ['0.0.0.0', '[::]', '[::1]'].includes(url.hostname)
  )
    throw new Error(
      'ABELE_SYNC_PHONE_HOST must be reachable from the separate phone, not loopback or a wildcard'
    )
  return { phoneHost: host, url: url.origin }
}

/** Waits for `/healthz`, or for the server to die trying. */
async function ready(url: string, child: ChildProcess, said: string[]): Promise<void> {
  const deadline = Date.now() + READY_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`the server exited with ${child.exitCode}: ${said.join('')}`)
    }
    try {
      // `globalThis.` said out loud: in the plugin a request goes through Obsidian, and the
      // bare name is barred to keep it that way. This is the test process, not the app.
      const response = await globalThis.fetch(`${url}/healthz`)
      if (response.ok) return
    } catch {
      /* not listening yet */
    }
    await delay(100)
  }
  throw new Error(`the server never answered ${url}/healthz: ${said.join('')}`)
}

/** A port nothing is on, by taking one and letting it go again. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      probe.close(() => (port === 0 ? reject(new Error('no free port')) : resolve(port)))
    })
  })
}

/** Waits for the process to be gone, and stops waiting after five seconds by force. */
async function ended(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  const force = setTimeout(() => child.kill('SIGKILL'), 5_000)
  try {
    await exited
  } finally {
    clearTimeout(force)
  }
}

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))
