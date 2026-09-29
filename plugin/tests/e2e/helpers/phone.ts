/**
 * The real phone, for `E2E_TARGET=phone`. Everything goes through a phone driver: a command
 * on the machine running the tier, named by `ABELE_PHONE_DRIVER` (default `iphone`), which
 * this repository does not ship. docs/Testing.md lists what it has to answer:
 *
 * - `eval --envelope --timeout S <code>` — evaluate in Obsidian's page, print
 *   `{"type","value"}` or `{"thrown"}` as JSON;
 * - `tap X Y`, `swipe X1 Y1 X2 Y2`, `longpress X Y`, `type TEXT`, `pinch SCALE`,
 *   `alert [BUTTON]` — real touches on the screen, in the page's CSS pixels (the page fills the
 *   screen); `orientation landscape|portrait` — the phone turned;
 * - `shot PATH` — a screenshot to a PNG file;
 * - `reverse PORT` — while it runs, 127.0.0.1:PORT on the phone reaches the same port here;
 * - `doctor` — one line per part, `OK`/`FAIL`, exit 0 when ready;
 * - `push-plugin DIR MANIFEST VAULT` — install a build into that vault on the phone.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export const DRIVER = process.env.ABELE_PHONE_DRIVER ?? 'iphone'

/** The vault on the phone the tier runs in: a copy of the fixture vault, never a real one. */
export const PHONE_VAULT = process.env.ABELE_PHONE_VAULT ?? 'abele-e2e'

export function driver(args: string[], timeoutMs = 60_000): string {
  return execFileSync(DRIVER, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/**
 * Evaluates `code` in Obsidian's page on the phone and prints the result the way the desktop
 * CLI's `eval` does, so `evalRaw` and everything built on it read both alike: a string as it
 * is, anything else as JSON, `undefined` as `(no output)`, a throw as `Error: <message>`.
 */
export function phoneEval(code: string, timeoutMs: number): string {
  let out: string
  try {
    out = driver(
      ['eval', '--envelope', '--timeout', String(Math.ceil(timeoutMs / 1000)), code],
      timeoutMs + 15_000
    )
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string; signal?: string }
    // Exit 3 is a throw in the page, reported on stdout; anything else is the transport.
    if (err.status === 3 && err.stdout) out = err.stdout.trim()
    else if (err.signal === 'SIGKILL')
      throw new Error(`the phone gave no answer in ${timeoutMs} ms`)
    else throw new Error(`the phone driver failed: ${(err.stderr || err.stdout || '').trim()}`)
  }
  const r = JSON.parse(out) as { type?: string; value?: unknown; thrown?: string }
  if (r.thrown !== undefined) return `Error: ${r.thrown.replace(/^\w*Error: /, '')}`
  if (r.type === 'undefined') return '(no output)'
  if (typeof r.value === 'string') return `=> ${r.value}`
  return `=> ${JSON.stringify(r.value, null, 2)}`
}

/** Real touches, in CSS pixels of the page (which fills the phone's screen). */
export const tap = (x: number, y: number): void => void driver(['tap', String(x), String(y)])
export const longPress = (x: number, y: number): void =>
  void driver(['longpress', String(x), String(y)])
export const swipe = (x1: number, y1: number, x2: number, y2: number): void =>
  void driver(['swipe', String(x1), String(y1), String(x2), String(y2)])
/** Types on the system keyboard into whatever has the focus. */
export const typeText = (text: string): void => void driver(['type', text])

/** The system or app dialog on screen: its text and buttons, or null when there is none. */
export function dialog(): { text: string[]; buttons: string[] } | null {
  const r = JSON.parse(driver(['alert'])) as {
    alert?: unknown
    text?: string[]
    buttons?: string[]
  }
  return r.alert === null ? null : { text: r.text ?? [], buttons: r.buttons ?? [] }
}
export const answerDialog = (button: string): void => void driver(['alert', button])

/** A picture of the phone's screen to `path`, its directory made first: the driver only writes. */
export const screenshot = (path: string): void => {
  mkdirSync(dirname(path), { recursive: true })
  driver(['shot', path])
}

/**
 * Makes 127.0.0.1:`port` on the phone lead to the same port here, for a server a test starts
 * (a fake GitHub, a calendar feed), so the URL the plugin is given works on both devices.
 * Returns the function that closes it again.
 */
export function exposeToPhone(port: number): () => void {
  const child: ChildProcess = spawn(DRIVER, ['reverse', String(port)], { stdio: 'ignore' })
  const deadline = Date.now() + 20_000
  for (;;) {
    const status = JSON.parse(driver(['status'])) as { reverse?: number[] }
    if (status.reverse?.includes(port)) break
    if (Date.now() > deadline) {
      child.kill()
      throw new Error(`the phone did not open port ${port} back to this machine`)
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200)
  }
  return () => void child.kill()
}

/**
 * The page side of the harness on a phone: `window.__e2eHost`, which a probe running inside
 * the page calls for what only this machine can do — `shot(path)` saves a screenshot here,
 * `tap(x, y)`, `swipe(x1, y1, x2, y2)`, `longPress(x, y)`, `type(text)`, `pinch(scale)` touch
 * the screen for real, and `orientation('landscape' | 'portrait')` turns the phone. Each is a request to the host server `phoneHost.ts` runs, through a reversed port. A
 * reload takes it away, so `reloadApp` puts it back. Absent on the desktop, which is how a
 * probe tells the two apart.
 */
export function installPhoneHost(): void {
  const port = process.env.ABELE_PHONE_HOST_PORT
  if (!port)
    throw new Error('ABELE_PHONE_HOST_PORT is not set: the phone run did not start its host')
  phoneEval(
    `(() => {
      // A request lost in the reversed port answers only when the phone gives up on it, after
      // 60 s — as long as a whole probe may take. Each is given its own deadline instead, so the
      // probe fails, or the picture is skipped, in time. The host logs what did arrive.
      const within = (ms, what, p) => Promise.race([p, new Promise((_, no) =>
        setTimeout(() => no(new Error('no answer from the host for ' + what + ' in ' + ms + ' ms')), ms))])
      const ask = (what, body, ms) => within(ms, what, requestUrl({ url: 'http://127.0.0.1:${port}/' + what,
          method: 'POST', contentType: 'application/json', body: JSON.stringify(body), throw: false }))
      const call = async (what, body) => {
        // A picture is asked for again when the first request was lost — dropped by the
        // reversed port or never answered. Only a picture: a touch asked for twice would touch twice.
        let r
        try { r = await ask(what, body, what === 'shot' ? 20000 : what === 'type' ? 45000 : 15000) } catch (error) {
          if (what !== 'shot') throw error
          r = await ask(what, body, 20000)
        }
        if (r.status !== 200) throw new Error('host ' + what + ': ' + r.text)
        return r.json
      }
      window.__e2eHost = {
        // Answers where the picture went: see SHOTS in phoneHost.ts. A picture that could not
        // be taken does not stop what is being measured: it answers why, in place of a path.
        shot: (path) => call('shot', { path }).then((r) => r.path, (e) => 'no picture: ' + String(e && e.message)),
        tap: (x, y) => call('tap', { x, y }),
        swipe: (x1, y1, x2, y2) => call('swipe', { x1, y1, x2, y2 }),
        longPress: (x, y) => call('longpress', { x, y }),
        type: (text) => call('type', { text }),
        pinch: (scale) => call('pinch', { scale }),
        orientation: (value) => call('orientation', { value }),
      }
      return 'ok'
    })()`,
    30_000
  )
}
