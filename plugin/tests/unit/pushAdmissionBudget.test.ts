import { expect, it } from 'vitest'
import {
  ExpectedWrites,
  MemoryFileSystem,
  MemoryStateStore,
  push,
  type EngineClient,
} from '@abele/sync-sdk/core'
import { bindScanScheduling } from '../../node_modules/@abele/sync-sdk/dist/internal/core/scanWork.js'

it('yields during admission of 33000 fresh operations before starting upload', async () => {
  const state = new MemoryStateStore()
  let visited = 0,
    last = 0,
    largest = 0,
    checkpoints = 0
  bindScanScheduling(state, () => ({
    yieldTask: async () => {
      largest = Math.max(largest, visited - last)
      last = visited
      checkpoints++
    },
  }))
  const client = {
    pathRefusal: () => {
      visited++
      return undefined
    },
    hasBlob: async () => {
      throw new Error('sample upload boundary')
    },
  } as unknown as EngineClient
  const ops = Array.from({ length: 33000 }, (_, i) => ({
    op: 'create' as const,
    path: `Notes/Section ${i % 31}/层/Sample ${i}.md`,
    sha: 'a'.repeat(64),
    size: 1,
    mtime: 1,
  }))
  await expect(
    push(
      client,
      new MemoryFileSystem(),
      state,
      {
        ops,
        hashes: new Map(),
        infos: new Map(),
        diskPaths: new Map(),
        dirty: new Set(),
        skipped: [],
        collisions: [],
      },
      { expected: new ExpectedWrites() }
    )
  ).rejects.toThrow('sample upload boundary')
  expect(visited).toBe(33000)
  expect(checkpoints).toBeGreaterThanOrEqual(128)
  expect(largest).toBeLessThanOrEqual(256)
})

it('honors state scheduling cancellation at an admission checkpoint', async () => {
  const state = new MemoryStateStore(),
    controller = new AbortController()
  let visited = 0
  bindScanScheduling(state, () => ({
    signal: controller.signal,
    yieldTask: async () => controller.abort(),
  }))
  const client = {
    pathRefusal: () => {
      visited++
      return undefined
    },
    hasBlob: async () => {
      throw new Error('upload must not start')
    },
  } as unknown as EngineClient
  const ops = Array.from({ length: 1000 }, (_, i) => ({
    op: 'create' as const,
    path: `Notes/Sample ${i}.md`,
    sha: 'a'.repeat(64),
    size: 1,
    mtime: 1,
  }))
  await expect(
    push(
      client,
      new MemoryFileSystem(),
      state,
      {
        ops,
        hashes: new Map(),
        infos: new Map(),
        diskPaths: new Map(),
        dirty: new Set(),
        skipped: [],
        collisions: [],
      },
      { expected: new ExpectedWrites() }
    )
  ).rejects.not.toThrow('upload must not start')
  expect(visited).toBeLessThanOrEqual(256)
  expect(await state.getJournal()).toBeNull()
})
