import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { buildSync } from 'esbuild'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { withNativeInput } from '../e2e/helpers/nativeInput'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(process.cwd(), 'node_modules/native-input-test-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

it('keeps complete input sequences together, not individual events', async () => {
  const events: string[] = []
  const lock = join(dir, 'input.lock')
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const first = withNativeInput(async () => {
    events.push('down-a')
    await held
    events.push('up-a')
  }, lock)
  const second = withNativeInput(() => {
    events.push('down-b', 'up-b')
  }, lock)
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(events).toEqual(['down-a'])
  release()
  await Promise.all([first, second])
  expect(events).toEqual(['down-a', 'up-a', 'down-b', 'up-b'])
})

it('releases a failed sequence without retrying its events', async () => {
  const lock = join(dir, 'input.lock')
  let calls = 0
  await expect(
    withNativeInput(() => {
      calls++
      throw new Error('lost key answer')
    }, lock)
  ).rejects.toThrow('lost key answer')
  await withNativeInput(() => {
    calls++
  }, lock)
  expect(calls).toBe(2)
})

it('serializes sequences in independent worker processes', async () => {
  const bundle = join(dir, 'input.mjs')
  buildSync({
    entryPoints: [join(__dirname, '../e2e/helpers/nativeInput.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundle,
  })
  const lock = join(dir, 'process.lock'),
    log = join(dir, 'events')
  const worker = (name: string) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
      import { withNativeInput } from ${JSON.stringify(bundle)}
      import { appendFileSync } from 'node:fs'
      await withNativeInput(async () => {
        appendFileSync(${JSON.stringify(log)}, 'down-${name}\\n')
        await new Promise(r => setTimeout(r, 100))
        appendFileSync(${JSON.stringify(log)}, 'up-${name}\\n')
      }, ${JSON.stringify(lock)})
    `,
        ],
        { stdio: 'pipe' }
      )
      child.on('error', reject)
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error('input worker exited: ' + code))
      )
    })
  await Promise.all([worker('a'), worker('b')])
  const events = readFileSync(log, 'utf8').trim().split('\n')
  expect(events).toEqual(
    events[0] === 'down-a'
      ? ['down-a', 'up-a', 'down-b', 'up-b']
      : ['down-b', 'up-b', 'down-a', 'up-a']
  )
})

it('never steals an old lock held by a live worker', async () => {
  const lock = join(dir, 'input.lock')
  mkdirSync(lock)
  writeFileSync(join(lock, String(process.pid)), '')
  utimesSync(lock, new Date(0), new Date(0))
  await expect(withNativeInput(() => {}, lock, 0)).rejects.toThrow('native input lock')
})
