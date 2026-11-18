import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { focusPhoneInput } from '../e2e/helpers/phoneInput'

it('polls native keyboard work without holding the driver reply open', async () => {
  const source = readFileSync(resolve(__dirname, '../e2e/githubConnections.e2e.test.ts'), 'utf8')
  const start = source.indexOf("    it('keeps the long connection list")
  const body = source
    .slice(start, source.lastIndexOf('\n  }'))
    .replace(/evalAsync<\{[\s\S]*?\}>/g, 'evalAsync')
  const evalAsync = vi.fn(() => {
    throw new Error('Native keyboard flow held the driver reply open')
  })
  const evalLong = vi.fn(async (_script: string) =>
    JSON.stringify({ overflow: 0, footer: 500, viewport: 600, shots: ['sample.png'] })
  )
  let run!: () => Promise<void>
  new Function(
    'it',
    'onPhone',
    'evalAsync',
    'evalLong',
    'expect',
    'PRELUDE',
    'shots',
    'focusPhoneInput',
    body
  )(
    (_name: string, callback: () => Promise<void>) => {
      run = callback
    },
    () => true,
    evalAsync,
    evalLong,
    expect,
    '',
    '/sample',
    focusPhoneInput
  )
  await run()
  expect(evalAsync).not.toHaveBeenCalled()
  expect(evalLong).toHaveBeenCalledOnce()
  expect(evalLong.mock.calls[0]?.[0]).toContain('focusPhoneInput')
})
