/**
 * Starts the fake calendar server of `fakeCalendarProcess.ts` in a process of its own, serving
 * the calendar text it is given, and says where it listens. Shared by the e2e files that put
 * an external calendar into the running app.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSync } from 'esbuild'
import { onPhone } from './target'
import { exposeToPhone } from './phone'

export interface CalendarProcess {
  origin: string
  stop(): void
}

export async function startCalendarProcess(ics: string): Promise<CalendarProcess> {
  const dir = mkdtempSync(join(tmpdir(), 'abele-fake-calendar-'))
  const bundle = join(dir, 'server.mjs')
  const file = join(dir, 'calendar.ics')
  writeFileSync(file, ics)
  buildSync({
    entryPoints: [join(__dirname, 'fakeCalendarProcess.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundle,
    logLevel: 'silent',
  })
  const child: ChildProcess = spawn(process.execPath, [bundle, file], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the fake calendar did not start')), 15_000)
    let out = ''
    child.stdout!.on('data', (chunk: Buffer) => {
      out += chunk.toString()
      const m = /listening (\d+)/.exec(out)
      if (m) {
        clearTimeout(timer)
        resolve(Number(m[1]))
      }
    })
    child.on('exit', (code) => reject(new Error(`the fake calendar exited with ${code}`)))
  })
  // On a real phone the same address has to lead here: see `exposeToPhone`.
  const unexpose = onPhone() ? exposeToPhone(port) : () => {}
  return {
    origin: `http://127.0.0.1:${port}`,
    stop: () => {
      unexpose()
      child.kill()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
