import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/audit/zod.json'
import exceptions from '../../scripts/audit-exceptions.json'
import { evaluateAudit } from '../../scripts/audit-dependencies.mjs'

const today = '2026-10-24'
const expires = exceptions[0].expires
const dayAfterExpiry = new Date(Date.parse(`${expires}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

describe('shipped dependency audit', () => {
  it('honours the advisory only at the recorded nested paths', () => {
    expect(exceptions[0].paths).toEqual(['node_modules/@abele/sync-sdk/node_modules/zod'])
    expect(evaluateAudit(fixture, exceptions, today)).toEqual([])
  })
  it.each(['node-protocol', 'channel-protocol'])('does not exempt nested %s Zod', (name) => {
    const audit = structuredClone(fixture)
    const path = `node_modules/@abele/${name}/node_modules/zod`
    audit.vulnerabilities.zod.nodes.push(path)
    expect(evaluateAudit(audit, exceptions, today)).toEqual([
      `Unexcepted advisory: GHSA-mrhx-c7xc-m3w5 ${path} (high)`,
    ])
  })
  it('fails after the exception expires', () => {
    expect(evaluateAudit(fixture, exceptions, dayAfterExpiry).join('\n')).toMatch(/expired/)
  })
  it('allows the exception through its expiry date', () => {
    expect(evaluateAudit(fixture, exceptions, expires)).toEqual([])
  })
  it('rejects a critical advisory alongside an excepted advisory', () => {
    const audit = structuredClone(fixture)
    audit.vulnerabilities.zod.via.push({
      ...audit.vulnerabilities.zod.via[0],
      url: 'https://github.com/advisories/GHSA-xxxx-yyyy-zzzz',
      severity: 'critical',
    })
    expect(evaluateAudit(audit, exceptions, today).join('\n')).toContain('critical')
  })
  it('rejects an unrelated advisory on an excepted package', () => {
    const audit = structuredClone(fixture)
    audit.vulnerabilities.zod.via[0].url = 'https://github.com/advisories/GHSA-xxxx-yyyy-zzzz'
    expect(evaluateAudit(audit, exceptions, today).join('\n')).toContain('GHSA-xxxx-yyyy-zzzz')
  })
  it('fails when an exception is unused', () => {
    expect(
      evaluateAudit({ auditReportVersion: 2, vulnerabilities: {} }, exceptions, today).join('\n')
    ).toMatch(/unused/)
  })
  it('does not exempt top-level zod', () => {
    const audit = structuredClone(fixture)
    audit.vulnerabilities.zod.nodes.push('node_modules/zod')
    expect(evaluateAudit(audit, exceptions, today).join('\n')).toContain('node_modules/zod')
  })
  it('fails when even one recorded path is no longer affected', () => {
    const audit = structuredClone(fixture)
    audit.vulnerabilities.zod.nodes.splice(0, 1, 'node_modules/zod')
    expect(evaluateAudit(audit, exceptions, today).join('\n')).toMatch(/unused/)
  })
  it('rejects malformed audit responses', () => {
    expect(() =>
      evaluateAudit({ error: { summary: 'Registry unavailable' } }, exceptions, today)
    ).toThrow()
  })
  it('ignores low severity advisories without an exception', () => {
    const audit = structuredClone(fixture)
    audit.vulnerabilities.zod.via[0].severity = 'low'
    expect(evaluateAudit(audit, [], today)).toEqual([])
  })
})
