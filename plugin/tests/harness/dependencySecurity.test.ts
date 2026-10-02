import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))

describe('dependency security baselines', () => {
  it.each([
    ['fflate', '0.8.3'],
    ['js-yaml', '4.3.2'],
    ['nanoid', '5.1.16'],
    ['vite', '6.4.3'],
    ['vitest', '4.1.11'],
    ['esbuild', '0.28.2'],
  ])('locks %s to the reviewed fixed release', (name, version) => {
    expect(lock.packages[`node_modules/${name}`].version).toBe(version)
  })
})
