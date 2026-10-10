import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

const source = readFileSync('tests/e2e/personalBaseline.e2e.test.ts', 'utf8')
const file = ts.createSourceFile('personalBaseline.ts', source, ts.ScriptTarget.Latest)

describe('personal baseline local authority cleanup', () => {
  it('sets no ad hoc local authority outside the shared token-pool fixture', () => {
    // Probe bodies are template strings too. Any direct write needs explicit cleanup coverage.
    expect(source).not.toMatch(/saveLocalStorage\s*\(/)
    const cases: ts.CallExpression[] = []
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(file) === 'liveCase')
        cases.push(node)
      ts.forEachChild(node, visit)
    }
    visit(file)
    expect(cases.length).toBeGreaterThan(0)
    expect(source).toContain('const fixture = liveSuite()')
    for (const one of cases) expect(one.arguments.at(-1)?.getText(file)).toBe('fixture')
  })
  it('delegates every case to cleanup that resets each leased device, including failure fallback', () => {
    const suite = readFileSync('tests/e2e/helpers/syncLiveCases.ts', 'utf8')
    const fixture = readFileSync('tests/e2e/helpers/tokenSyncLive.ts', 'utf8')
    const driver = readFileSync('tests/e2e/helpers/syncDriver.ts', 'utf8')
    expect(suite).toContain('await current.close()')
    expect(fixture).toContain('for (const [device, saved] of [...this.saved].reverse())')
    expect(fixture).toContain('await device.resetTokenState()')
    expect(fixture).toContain('await device.forceResetTokenState()')
    expect(driver).toContain('window.__abeleTest.resetSyncTokenState')
  })
})
