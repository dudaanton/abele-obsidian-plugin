import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('key-policy startup dependency', () => {
  it('initializes the app-backed store before reading device-local key decisions', () => {
    const source = readFileSync(join(__dirname, '../../src/main.ts'), 'utf8')
    const store = source.indexOf("startupStep('store',")
    const keys = source.indexOf('initializeDestinations(AbeleConfig.getInstance())')
    expect(store).toBeGreaterThan(0)
    expect(keys).toBeGreaterThan(store)
  })
})
