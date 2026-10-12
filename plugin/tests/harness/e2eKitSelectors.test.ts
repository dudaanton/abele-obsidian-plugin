import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const section = (title: string) => {
  const el = document.createElement('section')
  el.className = 'abele-section'
  const header = document.createElement('div')
  header.className = 'abele-section__header'
  const heading = document.createElement('h3')
  heading.className = 'abele-section__heading'
  heading.textContent = title
  header.append(heading)
  el.append(header)
  return el
}

describe('live probes follow shared kit anatomy', () => {
  it('locates the recent transactions section without a removed finance-only header class', () => {
    const text = readFileSync('tests/e2e/listSearch.e2e.test.ts', 'utf8')
    const locate = text.slice(
      text.indexOf('    const sidebarList ='),
      text.indexOf('    if (!(await until(() => sidebarList()')
    )
    const root = document.createElement('div')
    root.className = 'abele-finance-sidebar'
    root.append(section('Accounts'), section('Recent Transactions'))
    const expected = root.lastElementChild
    const doc = {
      querySelector: (selector: string) => root.querySelector(selector),
      querySelectorAll: (selector: string) => root.querySelectorAll(selector),
    }
    const run = new Function('document', `${locate};return sidebarList()`)
    expect(run(doc)).toBe(expected)
  })

  it('finds utility dialogs in the active document selected by the probe', () => {
    const text = readFileSync('tests/e2e/utilityDialogHost.e2e.test.ts', 'utf8')
    const line = text.split('\n').find((line) => line.includes('const root = await until(() =>'))!
    const predicate = line
      .slice(line.indexOf('() =>'), line.lastIndexOf(')'))
      .replace('${JSON.stringify(selector)}', JSON.stringify('.sample-dialog'))
    const docInit = text.split('\n').find((line) => line.includes('const doc =')) ?? ''
    const dialog = { connected: true }
    const inactive = { querySelector: () => null },
      active = { querySelector: () => dialog }
    const run = new Function('document', 'activeDocument', `${docInit};return (${predicate})()`)
    expect(run(inactive, active)).toBe(dialog)
  })

  it('reads geolocation notices from the active document rather than an inactive main window', () => {
    const text = readFileSync('tests/e2e/geolocation.e2e.test.ts', 'utf8')
    const start = text.indexOf('      return { message:')
    const answer = text.slice(start, text.indexOf('\n    })()`', start))
    const inactive = { querySelectorAll: () => [] }
    const active = {
      querySelectorAll: () => [{ textContent: 'Location unavailable. Check Location Services.' }],
    }
    const state = { root: { querySelector: () => null } }
    const run = new Function(
      'document',
      'activeDocument',
      'state',
      `const button={disabled:false};${answer}`
    )
    expect(run(inactive, active, state).message).toBe(
      'Location unavailable. Check Location Services.'
    )
  })
})
