import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { snapshotBaseline } from '../e2e/helpers/snapshotBaseline'

const dir = path.resolve(import.meta.dirname, '.snapshot-fixture')
const file = path.join(dir, 'sample.json')
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('snapshot approval', () => {
  it('does not create a missing baseline without explicit approval', () => {
    expect(() => snapshotBaseline(file, { value: 1 }, false)).toThrow('Missing snapshot baseline')
    expect(fs.existsSync(file)).toBe(false)
  })
  it('creates and replaces a baseline only in update mode', () => {
    expect(snapshotBaseline(file, { value: 1 }, true)).toEqual({ value: 1 })
    expect(snapshotBaseline(file, { value: 2 }, true)).toEqual({ value: 2 })
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ value: 2 })
  })
  it('returns the committed expectation, not the current value, without writing', () => {
    snapshotBaseline(file, { value: 1 }, true)
    expect(snapshotBaseline(file, { value: 2 }, false)).toEqual({ value: 1 })
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ value: 1 })
  })
})
