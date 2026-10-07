/**
 * The other half of the sync end-to-end: a real server in a process of its own, and a daemon
 * folder on disk standing in for a second device.
 *
 * Both come from the sibling repository as it is built, not from this one — the point of the
 * suite is the plugin talking to the shipped server over a socket, with the shipped daemon
 * putting the same vault on disk beside it. Nothing here is built: a missing `dist` means the
 * sibling has not been built and the suite skips rather than spending ten minutes building
 * somebody else's repository.
 */
import { spawn, spawnSync, type ChildProcess, type SpawnSyncReturns } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { verifySyncFixture } from '../../../scripts/verify-sync-inputs.mjs'
import { locateSyncRepository } from '../../../scripts/sync-repository.mjs'

/** Thrown when the sibling repository is absent or unbuilt; the suite skips on it. */
export class SiblingUnavailableError extends Error {}

/**
 * Only the explicit clean-archive ABELE_SYNC_DIR fixture; its provenance must match the
 * pinned plugin packages. Missing input is a failure, not sibling resolution or a skip.
 */
export const siblingRepositoryPath = locateSyncRepository(resolve(__dirname, '../../..'))
const SIBLING = process.env.ABELE_SYNC_DIR ? resolved(process.env.ABELE_SYNC_DIR) : ''
/**
 * The path with its links followed. In a worktree the sibling is reached through a symlink, and
 * the admin CLI runs only when the script it was started as is the file it is — a check that
 * compares the path as given with the path as loaded, so through the link it did nothing and
 * exited 0, and `create-account` made no account without a word.
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
const DAEMON = join(SIBLING, 'packages/cli/dist/index.js')

/** How long the server has to answer `/healthz` before the suite gives up on it. */
const READY_MS = 30_000
/**
 * How long one daemon or admin command may take. A `run --once` uploads and downloads, but the
 * suite's are a few kilobytes; the cap is the tier's own per-call ceiling, because the call
 * blocks the test worker and the runner kills a worker that is silent for a minute.
 */
const DAEMON_MS = 45_000

export interface SyncServer {
  /** Where the server listens: `http://127.0.0.1:<port>`. */
  url: string
  /** Makes an account the way an operator would, through the admin CLI. */
  createAccount(email: string, password: string): void
  /** Safe to call twice; takes the database and the blobs with it. */
  kill(): Promise<void>
}

/** Whether the sibling is there and built. Nothing here works without it. */
export function siblingBuilt(): boolean {
  return existsSync(SERVER) && existsSync(ADMIN) && existsSync(DAEMON)
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
    throw new SiblingUnavailableError('the explicit sync fixture has no built server and daemon')
  return null
}

/**
 * A server on a free port, with a database and a blob directory of its own under `dir`.
 *
 * The caller owns `dir` — the suite puts it beside the daemon folder so one cleanup takes
 * everything — and `kill` removes what the server wrote inside it.
 */
export async function spawnSyncServer(dir: string): Promise<SyncServer> {
  verifySyncFixture(SIBLING)
  if (!siblingBuilt()) {
    throw new SiblingUnavailableError(`${SIBLING} has no built server or daemon`)
  }
  const port = await freePort()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ABELE_DATABASE_URL: `sqlite://${join(dir, 'abele.db')}`,
    ABELE_BLOB_DIR: join(dir, 'blobs'),
    ABELE_MASTER_KEY: randomBytes(32).toString('hex'),
    ABELE_TOKEN_PEPPER: randomBytes(16).toString('hex'),
    ABELE_PORT: String(port),
    ABELE_HOST: '127.0.0.1',
  }

  const child = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  // Held rather than printed: a suite that passes says nothing, and one that does not gets
  // the server's own words in the failure.
  const said: string[] = []
  child.stdout?.on('data', (chunk: Buffer) => said.push(chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => said.push(chunk.toString()))

  const url = `http://127.0.0.1:${port}`
  let killed = false
  const kill = async (): Promise<void> => {
    if (!killed) {
      killed = true
      child.kill('SIGTERM')
      await ended(child)
    }
    await rm(join(dir, 'blobs'), { recursive: true, force: true })
    for (const suffix of ['', '-wal', '-shm']) {
      await rm(`${join(dir, 'abele.db')}${suffix}`, { force: true })
    }
  }

  try {
    await ready(url, child, said)
  } catch (error) {
    await kill()
    throw error
  }

  return {
    url,
    kill,
    createAccount(email: string, password: string): void {
      const done = spawnSync(
        process.execPath,
        [ADMIN, 'create-account', '--email', email, '--password', password],
        { env, encoding: 'utf8', timeout: DAEMON_MS, killSignal: 'SIGKILL' }
      )
      if (done.status !== 0) {
        throw new Error(`create-account failed: ${outcome(done)}`)
      }
      // Its own line says it did it. An exit of 0 alone is what the admin CLI answered, through
      // a symlink, when it had run nothing at all.
      if (!done.stdout.includes('created account')) {
        throw new Error(`create-account made no account: ${outcome(done) || 'it said nothing'}`)
      }
    },
  }
}

export interface DaemonSetup {
  dir: string
  serverUrl: string
  email: string
  password: string
  /** The vault to join, or to create when the account has none by that name. */
  vaultName: string
  deviceName: string
}

/** `abele-sync init`, as a person would run it: the password through the environment. */
export function initDaemon(setup: DaemonSetup): void {
  const done = daemon(
    [
      'init',
      '--server',
      setup.serverUrl,
      '--dir',
      setup.dir,
      '--email',
      setup.email,
      '--vault',
      setup.vaultName,
      '--device-name',
      setup.deviceName,
    ],
    { ABELE_PASSWORD: setup.password }
  )
  if (done.status !== 0) throw new Error(`abele-sync init failed: ${outcome(done)}`)
}

/** One `abele-sync run --once` in the folder, or an error carrying what it printed. */
export function daemonSyncOnce(dir: string): string {
  const done = daemon(['run', '--dir', dir, '--once'])
  if (done.status !== 0) {
    throw new Error(`abele-sync run --once failed: ${outcome(done)}`)
  }
  return done.stdout
}

/** What `init` wrote: which server, which vault, and the token this folder syncs on. */
export function daemonConfig(dir: string): {
  serverUrl: string
  vaultId: string
  deviceId: string
  deviceName: string
} {
  return JSON.parse(readFileSync(join(dir, '.abele-sync/config.json'), 'utf8'))
}

function daemon(argv: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [DAEMON, ...argv], {
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
    timeout: DAEMON_MS,
    // SIGKILL, as everywhere in this tier: a timeout that sends a signal the process can sit
    // through is not a timeout.
    killSignal: 'SIGKILL',
  })
}

/**
 * What a command that failed said — or, when it said nothing because it was killed at the cap,
 * that it was.
 */
function outcome(done: SpawnSyncReturns<string>): string {
  if (done.signal !== null) return `killed by ${done.signal} after ${DAEMON_MS} ms`
  return done.stderr || done.stdout || String(done.error ?? `exit ${done.status}`)
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
