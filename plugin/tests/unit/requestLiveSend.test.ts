import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'

it('the live Send helper waits for the new send, including an asynchronous flush before dispatch', async () => {
  const source = readFileSync('tests/e2e/requests.e2e.test.ts', 'utf8')
  const helper = /const send=(async\(\)=>\{[\s\S]*?\n\});/.exec(source)![1]
  const entry = { latestSend: 'old-send', outcome: { kind: 'answered' } }
  const state = { sending: [] as string[] }
  let finish!: () => void
  const answer = new Promise<void>((resolve) => {
    finish = resolve
  })
  const button = {
    disabled: false,
    textContent: 'Send',
    classList: { contains: () => false },
    click: () => {
      void Promise.resolve().then(async () => {
        entry.latestSend = 'new-send'
        entry.outcome = { kind: 'sending' }
        state.sending = ['sample-request']
        await answer
        entry.outcome = { kind: 'answered' }
        state.sending = []
      })
    },
  }
  const until = async (read: () => unknown) => {
    for (let i = 0; i < 100; i++) {
      const value = read()
      if (value) return value
      await Promise.resolve()
    }
    throw new Error('Send did not settle')
  }
  let settled = false
  const pending = (
    runInNewContext(`(${helper})()`, {
      tab: () => ({ querySelector: () => button }),
      shown: { view: { getState: () => ({ id: 'sample-request' }) } },
      requests: { model: () => ({ entry: () => entry, state }) },
      until,
    }) as Promise<void>
  ).then(() => {
    settled = true
  })
  try {
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(settled).toBe(false)
    expect(entry.outcome.kind).toBe('sending')
  } finally {
    finish()
    await pending
  }
  expect(entry.latestSend).toBe('new-send')
  expect(settled).toBe(true)
})
