// @vitest-environment node
import { expect, it } from 'vitest'
import { MemoryFileSystem, MemoryStateStore } from '@abele/sync-sdk/core'
import { refreshLocalPaths } from '../../node_modules/@abele/sync-sdk/dist/internal/core/localPaths.js'

it('visits 33k tracked siblings linearly and yields throughout replay inventory construction', async () => {
  const count = 33000,
    state = new MemoryStateStore()
  let visits = 0,
    turnVisits = 0,
    longestTurnVisits = 0
  const children = Array.from({ length: count }, (_, i) => ({
    get path() {
      // Stop a quadratic regression promptly rather than spending a billion visits.
      longestTurnVisits = Math.max(longestTurnVisits, ++turnVisits)
      if (++visits > count * 8) throw new Error('sibling visit budget exceeded')
      return `Notes/Sample ${i}.md`
    },
    kind: 'file' as const,
  }))
  for (let i = 0; i < count; i++) {
    const path = `Notes/Sample ${i}.md`
    await state.put({
      path,
      wirePath: path,
      fileId: path,
      versionId: 'v1',
      sha: 'a'.repeat(64),
      size: 1,
      mtime: 1,
    })
  }
  await state.setJournal({
    batchId: 'sample-batch',
    idempotencyKey: 'sample-request',
    startedAt: new Date().toISOString(),
    ops: [{ op: 'create', path: 'Notes/Pending.md', sha: 'b'.repeat(64), size: 1, mtime: 1 }],
  })
  let reads = 0
  const fs = Object.assign(new MemoryFileSystem(), {
    listChildren: async (parent: string) => {
      reads++
      return parent === '' ? [{ path: 'Notes', kind: 'directory' as const }] : children
    },
  })
  let last = process.threadCpuUsage(),
    longestCpuMs = 0
  const checkpoint = () => {
    const now = process.threadCpuUsage()
    longestCpuMs = Math.max(longestCpuMs, (now.user - last.user + now.system - last.system) / 1000)
  }
  const yieldTask = async () => {
    checkpoint()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    turnVisits = 0
    last = process.threadCpuUsage()
  }
  {
    await refreshLocalPaths(fs, state, { yieldTask })
    checkpoint()
    console.log('tracked sibling replay', { count, visits, reads, longestCpuMs, longestTurnVisits })
    expect(visits).toBeLessThanOrEqual(count * 8)
    expect(reads).toBe(2)
    // Each phase inspects at most 64 sibling paths per host task.
    // Work and current-thread CPU exclude time spent waiting for the scheduler.
    expect(longestTurnVisits).toBeLessThanOrEqual(64)
    expect(longestCpuMs).toBeLessThan(50)
    let retained = 0
    for await (const _entry of state.all()) retained++
    expect(retained).toBe(count)
  }
}, 30000)
