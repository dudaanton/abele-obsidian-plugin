import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/audit/zod.json'
import exceptions from '../../scripts/audit-exceptions.json'
import { evaluateAudit } from '../../scripts/audit-dependencies.mjs'

const today = '2026-10-24'

describe('shipped dependency audit', () => {
  it('honours the advisory only at the recorded nested paths', () => {
    expect(evaluateAudit(fixture, exceptions, today)).toEqual([])
  })
  it('fails after the exception expires', () => {
    expect(evaluateAudit(fixture, exceptions, '2026-11-08').join('\n')).toMatch(/expired/)
  })
  it('allows the exception through its expiry date', () => {
    expect(evaluateAudit(fixture, exceptions, '2026-11-07')).toEqual([])
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
    audit.vulnerabilities.zod.nodes.pop()
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
