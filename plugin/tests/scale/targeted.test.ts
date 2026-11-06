// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  visibilityExperiment,
  targetedBudgets,
  contentRequestDelay,
  postSealEvidence,
} from './targeted.mjs'
import { planVault } from './generate.mjs'
import { WireProxy } from './proxy.mjs'
import { createServer } from 'node:http'

describe('targeted probe', () => {
  it('keeps the independent strict task gate failing for malformed tasks even in legacy report-only mode', () => {
    const rows = targetedBudgets({ targeted: { E: { complete: true } },
      installedFileReadbackBytes: 0, mismatches: [], profileCoverageRequired: true,
      longTasksReportOnly: true, longTaskAttribution: [{ attributionPass: false }] })
    expect(rows.find(row => row.name === 'long task ownership and budgets')?.status).toBe('FAIL')
  })
  it('reports unattributed tasks without failing an explicitly report-only probe', () => {
    const report: any = { targeted: { E: { complete: true } }, installedFileReadbackBytes: 0,
      mismatches: [], profileCoverageRequired: true, longTaskAttribution: [{ attributionPass: false }] }
    expect(targetedBudgets(report).find(row => row.name === 'E')?.status).toBe('FAIL')
    report.longTasksReportOnly = true
    expect(targetedBudgets(report).find(row => row.name === 'E')?.status).toBe('PASS')
    report.installedFileReadbackBytes = 1
    expect(targetedBudgets(report).find(row => row.name === 'E')?.status).toBe('FAIL')
  })
  it('keeps host post-seal digests separate and never forgives unknown callers', () => {
    const rows = [
      {
        device: '1',
        at: 1,
        event: 'renderer-hash',
        source: 'abele',
        sha: 'sample',
        bytes: 40,
        stack: 'at async Object.seal',
      },
      {
        device: '1',
        at: 2,
        event: 'renderer-hash',
        source: 'host',
        sha: 'sample',
        bytes: 40,
        stack: 'at hostIndex',
      },
      {
        device: '1',
        at: 3,
        event: 'renderer-hash',
        source: 'abele',
        sha: 'sample',
        bytes: 40,
        stack: 'at pluginFingerprint',
      },
      {
        device: '1',
        at: 4,
        event: 'renderer-hash',
        source: 'unknown',
        sha: 'sample',
        bytes: 40,
        stack: 'at unresolvedCaller',
      },
    ]
    const result = postSealEvidence(rows, '1')
    expect(result.plugin.map((r: any) => r.at)).toEqual([3])
    expect(result.host.map((r: any) => r.at)).toEqual([2])
    expect(result.unknown.map((r: any) => r.at)).toEqual([4])
    expect(result.seals).toEqual([{ sha: 'sample', at: 1 }])
    const initialPull = postSealEvidence(rows, '1', { untilAt: 2 })
    expect(initialPull.plugin).toEqual([])
    expect(initialPull.laterPlugin.map((r: any) => r.at)).toEqual([3])
    expect(initialPull.laterUnknown.map((r: any) => r.at)).toEqual([4])
  })
  it('keeps equal visibility windows and restores foreground after failures', async () => {
    let now = 0
    const states: boolean[] = []
    const result = await visibilityExperiment({
      durationMs: 180000,
      now: () => now,
      sleep: async (ms: number) => {
        now += ms
      },
      visibility: async (v: boolean) => {
        states.push(v)
        return { visible: v }
      },
      sample: async () => ({ at: now }),
    })
    expect(states).toEqual([true, false, true, true])
    expect(result.map((r: any) => [r.visible, r.endAt - r.beginAt, r.samples.length])).toEqual([
      [true, 180000, 6],
      [false, 180000, 6],
      [true, 180000, 6],
    ])
    await expect(
      visibilityExperiment({
        durationMs: 1,
        now: () => now,
        sleep: async () => {
          throw new Error('sample stopped')
        },
        sample: async () => ({}),
        visibility: async (v: boolean) => {
          states.push(v)
        },
      })
    ).rejects.toThrow('sample stopped')
    expect(states.at(-1)).toBe(true)
  })
  it('paces only content GETs with an aggregate schedule', () => {
    expect(contentRequestDelay('GET', '/v2/files/f/content', 100, 0, 120)).toEqual({
      delay: 0,
      next: 220,
    })
    expect(contentRequestDelay('GET', '/v2/files/g/content', 110, 220, 120)).toEqual({
      delay: 110,
      next: 340,
    })
    expect(contentRequestDelay('POST', '/v2/commit', 110, 220, 120)).toEqual({
      delay: 0,
      next: 220,
    })
  })
  it('fails incomplete phases and absent read coverage', () => {
    const r: any = {
      targeted: {
        A: { complete: true },
        B: { complete: true },
        C: { complete: true, syncDuringIndexWait: true },
        D: { complete: true, tokenPresent: true, commitCut: true },
        E: { complete: true },
      },
      failures: [],
      restartReadEvidence: [
        { complete: true, syncBytes: 0 },
        { complete: true, syncBytes: 0 },
      ],
      installedFileReadbackBytes: 0,
      mismatches: [],
    }
    expect(targetedBudgets(r).every((x: any) => x.status === 'PASS')).toBe(true)
    r.failures = [
      { step: 'synced restart captured startup' },
      { step: 'stopped-app changes captured startup' },
    ]
    expect(
      targetedBudgets(r)
        .filter((x: any) => x.status === 'FAIL')
        .map((x: any) => x.name)
    ).toEqual(['B', 'C'])
    r.failures = []
    r.restartReadEvidence[1].complete = false
    r.targeted.C.syncDuringIndexWait = false
    r.failures.push({ step: 'second device pull' })
    expect(
      targetedBudgets(r)
        .filter((x: any) => x.status === 'FAIL')
        .map((x: any) => x.name)
    ).toEqual(['A', 'B', 'C'])
  })
  it('adds wide folder without changing rename source or byte budget', () => {
    const p = planVault({ seed: 42, files: 5000, bytes: 1700000000, wideFolderFiles: 512 })
    expect(p.filter((f: any) => f.path.startsWith('Notes/Wide/'))).toHaveLength(512)
    expect(p.filter((f: any) => f.path.startsWith('Notes/Section 1/层 1/Nested 1/'))).toHaveLength(
      32
    )
    expect(p.reduce((n: number, f: any) => n + f.size, 0)).toBe(1700000000)
  })
  it('applies pacing to real content forwarding and releases its sockets', async () => {
    const upstream = createServer((_req, res) => res.end('sample'))
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    const address = upstream.address() as { port: number }
    const proxy = new WireProxy(`http://127.0.0.1:${address.port}`, 'sample')
    const endpoint = await proxy.start()
    proxy.contentSpacingMs = 100
    try {
      await Promise.all(
        ['a', 'b', 'c'].map(async (name) => {
          const response = await globalThis.fetch(`${endpoint}/v2/files/${name}/content`)
          expect(await response.text()).toBe('sample')
        })
      )
      const starts = proxy.events.filter((e: any) => e.event === 'start')
      expect(starts[2].at - starts[0].at).toBeGreaterThanOrEqual(175)
      const response = await globalThis.fetch(`${endpoint}/v2/connection`)
      await response.text()
      expect(proxy.active.size).toBe(0)
    } finally {
      await proxy.close()
      await new Promise<void>((resolve) => upstream.close(() => resolve()))
    }
  })
})
