/**
 * The machine side of a phone run, started once by `globalSetup`: the phone taken for the run
 * (a lock other users of the phone respect), a small HTTP server the page reaches through a
 * reversed port for screenshots and real touches (`installPhoneHost`), and the plugin build
 * installed in the phone's vault. See docs/Testing.md.
 */
import { execFile, execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { confirmReload, type ReloadWitness } from './reloadWitness'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import { shotDir } from './shots'
import {
  DRIVER,
  PHONE_VAULT,
  driver,
  exposeToPhone,
  installPhoneHost,
  phoneEval,
  swipeDriverArgs,
} from './phone'

/**
 * The phone is one device: a run holds it from start to end, through the driver's lock
 * (`take`/`drop`), which everything else that drives the phone respects too — the driver waits
 * while someone else holds it. The lock is held under a name, `IPHONE_LOCK_OWNER`: every driver
 * command this run and its test files make carries it, and that is what makes the phone theirs.
 * A name set by whoever started the run (a batch or a session holding the phone already) is used
 * as it is, and the lock stays theirs: the run gives back only a lock it took itself. This
 * process's pid goes with the take, so a run that dies leaves the lock stale for the next user.
 */
let tookPhone = false

export function takePhone(who: string, waitMs = 30 * 60_000): void {
  const name = (process.env.IPHONE_LOCK_OWNER ||= `${who}-${process.pid}`.replace(/\s+/g, '-'))
  let verdict: string
  try {
    verdict = driver(['take', name, '--wait', '--pid', String(process.pid)], waitMs)
  } catch {
    throw new Error(
      `the phone stayed taken for ${waitMs / 60_000} minutes (${DRIVER} doctor says by whom)`
    )
  }
  tookPhone = verdict.split('\n').pop() === 'taken'
}

const sleepSync = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Gives the phone back, only when this run took it: a lock it found under its name is left. */
export function dropPhone(): void {
  if (!tookPhone) return
  tookPhone = false
  try {
    driver(['drop', process.env.IPHONE_LOCK_OWNER ?? ''])
  } catch {
    // Not ours any more (taken away as stale): nothing to give back.
  }
}

/** Stops the run with the driver's own report when any part the tier needs is down. */
export function assertPhoneReady(): void {
  let out = ''
  let ok = true
  try {
    out = execFileSync(DRIVER, ['doctor'], {
      encoding: 'utf8',
      timeout: 120_000,
    })
  } catch (error) {
    out = String((error as { stdout?: string }).stdout ?? error)
    ok = false
  }
  // The plugin's own line is what the run is about to fix by installing its build.
  const failing = out.split('\n').filter((l) => l.startsWith('FAIL') && !/^FAIL\s+abele\b/.test(l))
  if (failing.length || (!ok && !out.includes('FAIL')))
    throw new Error(`The phone is not ready (${DRIVER} doctor, run ${process.pid}):\n${out}`)
}

/**
 * Builds the plugin the way `build:test` does (the test API included) into a scratch
 * directory and installs it in the phone's vault; `ABELE_PHONE_BUILD` names a build directory
 * to install instead. Then reloads Obsidian and waits for exactly that version.
 */
export async function installBuild(pluginDir: string): Promise<string> {
  const manifestPath = resolve(pluginDir, '..', 'manifest.json')
  const version = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { version: string }).version
  let dir = process.env.ABELE_PHONE_BUILD
  let scratch = ''
  if (!dir) {
    scratch = dir = mkdtempSync(join(tmpdir(), 'abele-phone-build-'))
    execFileSync(
      'npx',
      ['vite', 'build', '--mode', 'development', '--outDir', dir, '--emptyOutDir'],
      {
        cwd: pluginDir,
        stdio: 'ignore',
        timeout: 10 * 60_000,
      }
    )
  }
  const hashes = Object.fromEntries(
    [
      ['main.js', join(dir, 'main.js')],
      ['styles.css', join(dir, existsSync(join(dir, 'main.css')) ? 'main.css' : 'styles.css')],
      ['manifest.json', manifestPath],
    ].map(([name, path]) => [name, createHash('sha256').update(readFileSync(path)).digest('hex')])
  )
  try {
    // Version alone cannot identify a development build. Require both installed bytes and
    // the API object of the generation that loaded these bytes on this very vault.
    let matches = false
    try {
      matches =
        phoneEval(
          `(async () => {
        if (app.vault.getName() !== ${JSON.stringify(PHONE_VAULT)} || !window.__abeleTest) return false
        const hashes = ${JSON.stringify(hashes)}
        const loaded = window.__e2eInstalledBuild
        if (!loaded || loaded.api !== window.__abeleTest || loaded.generation !== performance.timeOrigin ||
          JSON.stringify(loaded.hashes) !== JSON.stringify(hashes)) return false
        for (const [name, expected] of Object.entries(hashes)) {
          const bytes = await app.vault.adapter.readBinary(app.vault.configDir + '/plugins/abele/' + name)
          const digest = await crypto.subtle.digest('SHA-256', bytes)
          const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
          if (hash !== expected) return false
        }
        return loaded.api === window.__abeleTest && loaded.generation === performance.timeOrigin
      })()`,
          30_000
        ) === '=> true'
    } catch {
      // Unreadable files or an unavailable hash API are not evidence of an installed build.
    }
    if (matches) return version
    driver(['push-plugin', dir, manifestPath, PHONE_VAULT], 10 * 60_000)
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true })
  }
  // Someone else's run may have left another vault open: the test vault is opened by name.
  let vault = phoneEval('app.vault.getName()', 30_000)
  if (vault !== `=> ${PHONE_VAULT}`) {
    driver(['open-url', `obsidian://open?vault=${encodeURIComponent(PHONE_VAULT)}`])
    const until = Date.now() + 60_000
    while (vault !== `=> ${PHONE_VAULT}` && Date.now() < until) {
      sleepSync(2000)
      try {
        vault = phoneEval('window.app && app.vault ? app.vault.getName() : ""', 15_000)
      } catch {
        // Between two vaults the page is not there to ask.
      }
    }
    if (vault !== `=> ${PHONE_VAULT}`)
      throw new Error(`Obsidian on the phone has ${vault} open and would not open ${PHONE_VAULT}`)
  }
  const key = 'abele-e2e-install-request'
  const requestId = 'install-' + Date.now() + '-' + Math.random().toString(36).slice(2)
  const read = (): ReloadWitness =>
    JSON.parse(
      phoneEval(
        `JSON.stringify({ owner: app.vault.getName(), generation: performance.timeOrigin,
      requestId: sessionStorage.getItem('${key}'), mobile: !!app.isMobile,
      apiReady: !!window.__abeleTest && app.plugins.plugins.abele?.manifest.version === ${JSON.stringify(version)},
      layoutReady: !!app.workspace.layoutReady })`,
        10_000
      ).replace(/^=> /, '')
    ) as ReloadWitness
  await confirmReload(
    read(),
    requestId,
    true,
    {
      request: () =>
        phoneEval(
          `(() => {
      sessionStorage.setItem('${key}', ${JSON.stringify(requestId)})
      setTimeout(() => location.reload(), 50)
      return ${JSON.stringify(requestId)}
    })()`,
          30_000
        ).replace(/^=> /, ''),
      read,
      now: Date.now,
      pause: (ms) => new Promise((done) => setTimeout(done, ms)),
    },
    120_000
  )
  phoneEval(
    `(() => {
    window.__e2eInstalledBuild = { hashes: ${JSON.stringify(hashes)},
      generation: performance.timeOrigin, api: window.__abeleTest }
    sessionStorage.removeItem('${key}')
    return 'ready'
  })()`,
    30_000
  )
  return version
}

/** Where the phone's pictures go. */
export const SHOTS = process.env.ABELE_PHONE_SHOTS ?? shotDir('abele-iphone')

let server: Server | undefined
let unexpose: (() => void) | undefined

/**
 * Every request the page makes of the host, when it arrived and how the driver answered, one
 * line each: a picture or a touch that never came back can then be told apart — never arrived
 * (lost in the reversed port) or arrived and the driver took that long.
 */
const HOST_LOG = process.env.ABELE_PHONE_HOST_LOG ?? join(tmpdir(), 'abele-phone-host.log')
const hostLog = (line: string): void => {
  try {
    appendFileSync(HOST_LOG, `${new Date().toISOString()} ${process.pid} ${line}\n`)
  } catch {
    // a log that cannot be written must not fail the run
  }
}

const run = (args: string[]): Promise<string> =>
  new Promise((done, fail) =>
    execFile(DRIVER, args, { timeout: 60_000 }, (err, stdout, stderr) =>
      err ? fail(new Error(String(stderr || err.message))) : done(stdout)
    )
  )

/** The server the page's `__e2eHost` talks to; see `installPhoneHost`. */
export async function startHost(): Promise<void> {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c: Buffer) => (body += c.toString()))
    req.on('end', () => {
      const b = (body ? JSON.parse(body) : {}) as Record<string, string | number>
      const n = (k: string) => String(Math.round(Number(b[k])))
      const what = (req.url ?? '').slice(1)
      let args: string[]
      let answer = '{"ok":true}'
      if (what === 'shot') {
        // Beside the desktop's pictures, not among them: both tiers name theirs alike.
        const path = join(SHOTS, basename(String(b.path)))
        mkdirSync(SHOTS, { recursive: true })
        args = ['shot', path]
        answer = JSON.stringify({ path })
      } else if (what === 'tap') args = ['tap', n('x'), n('y')]
      else if (what === 'longpress') args = ['longpress', n('x'), n('y')]
      else if (what === 'swipe')
        args = swipeDriverArgs(
          Number(n('x1')),
          Number(n('y1')),
          Number(n('x2')),
          Number(n('y2')),
          b.velocity === undefined ? undefined : Number(b.velocity),
          b.hold === undefined ? undefined : Number(b.hold)
        )
      else if (what === 'type') args = ['type', String(b.text)]
      else if (what === 'pinch') args = ['pinch', String(Number(b.scale))]
      else if (what === 'orientation') args = ['orientation', String(b.value)]
      else {
        res.writeHead(404, { Connection: 'close' }).end('unknown')
        return
      }
      const started = Date.now()
      hostLog(`${what} arrived`)
      run(args).then(
        // No keep-alive: a connection the phone kept for its next request was one the reversed
        // port had already closed, and that request timed out.
        () => {
          hostLog(`${what} ok ${Date.now() - started} ms`)
          res
            .writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' })
            .end(answer)
        },
        (e: Error) => {
          hostLog(`${what} failed ${Date.now() - started} ms: ${e.message.split('\n')[0]}`)
          res.writeHead(500, { Connection: 'close' }).end(e.message)
        }
      )
    })
  })
  await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done))
  const port = (server.address() as AddressInfo).port
  process.env.ABELE_PHONE_HOST_PORT = String(port)
  unexpose = exposeToPhone(port)
  installPhoneHost()
}

export function stopHost(): void {
  unexpose?.()
  server?.close()
}
