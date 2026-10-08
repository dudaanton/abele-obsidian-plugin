import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('tests/e2e/personalBaseline.e2e.test.ts', 'utf8')
const keysText = source.match(/const localKeys = (\[[\s\S]*?\])/)[1]
const keys: string[] = new Function(`return ${keysText}`)()
const snapshot = source.match(/`(Object\.fromEntries\([^\n]+)`/)[1]
const expression = snapshot.replace('${JSON.stringify(localKeys)}', JSON.stringify(keys))

describe('personal baseline local authority cleanup', () => {
  it('keeps missing keys across the JSON transport so teardown clears newly created authority', () => {
    const local = new Map<string, unknown>()
    const app = { loadLocalStorage: (key: string) => local.get(key) }
    const saved = JSON.parse(JSON.stringify(new Function('app', `return ${expression}`)(app)))
    for (const key of keys) local.set(key, { synthetic: 'temporary authority' })
    // The real teardown iterates the transported snapshot, not the original key list.
    for (const [key, value] of Object.entries(saved)) {
      if (value == null) local.delete(key)
      else local.set(key, value)
    }
    expect([...local.entries()]).toEqual([])
    expect(Object.keys(saved)).toEqual(keys)
  })
})
