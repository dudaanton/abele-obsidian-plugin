import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

describe('test tier ownership', () => {
  it('runs complexity tests once, using the fast configuration', () => {
    expect(pkg.scripts['test:all']).not.toContain('test:perf')
    expect(pkg.scripts['test:perf']).toBe('vitest run .perf.test.ts')
    expect(fs.existsSync(path.join(root, 'vitest.perf.config.ts'))).toBe(false)
  })
})
