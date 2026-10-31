import assert from 'node:assert/strict'
import { test } from 'node:test'
import { enablePluginWhenReady } from './startup-enable.mjs'

test('startup enable retries a transient CLI timeout', async () => {
  let attempts = 0
  const device = { evaluate: async () => {
    attempts++
    if (attempts === 1) {
      const error = new Error('Vault CLI unavailable')
      error.scaleCliFailure = { code: 124 }
      throw error
    }
    return true
  } }
  const wait = async (_name, probe) => { for (;;) if (await probe()) return }
  await enablePluginWhenReady(device, wait)
  assert.equal(attempts, 2)
})

test('startup enable exposes a product action failure', async () => {
  const device = { evaluate: async () => { throw new Error('Vault action failed') } }
  const wait = async (_name, probe) => probe()
  await assert.rejects(enablePluginWhenReady(device, wait), /Vault action failed/)
})
