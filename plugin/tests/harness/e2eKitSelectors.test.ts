import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
const syncSource = readFileSync('tests/e2e/helpers/syncDriver.ts', 'utf8')
const preludeStart =
  syncSource.indexOf('export const SYNC_PRELUDE = ') + 'export const SYNC_PRELUDE = '.length
const SYNC_PRELUDE = new Function(
  `return ${syncSource.slice(preludeStart, syncSource.indexOf('\n`', preludeStart) + 2)}`
)()

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
  it('finds an exact section title in its header without adopting a nested section heading', () => {
    const root = document.createElement('div'),
      outer = section('Sample outer'),
      inner = section('Sample waiting (1)')
    outer.append(inner)
    root.append(outer, section('Sample waiting (2)'))
    const find = new Function(
      'window',
      'root',
      'title',
      `${SYNC_PRELUDE};return sectionTitled(root,title)`
    )
    const window = { __abeleTest: { SyncService: { getInstance: () => ({}) } } }
    expect(find(window, root, 'Sample waiting (1)')).toBe(inner)
    expect(find(window, root, 'Sample outer')).toBe(outer)
    expect(find(window, root, 'Sample waiting')).toBeNull()
  })

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

  it('closes the owned temporary settings vault before asking an unresponsive renderer to disconnect', async () => {
    const text = readFileSync('tests/e2e/syncSettings.e2e.test.ts', 'utf8')
    const start = text.indexOf('  afterAll(async () => {') + '  afterAll(async () => {'.length
    const body = text.slice(start, text.indexOf('\n  }, 300_000)', start))
    const calls: string[] = []
    const vault = {
      path: 'sample-temporary-vault',
      dispose: vi.fn(async () => {
        calls.push('dispose')
      }),
    }
    const sync = {
      frontAsIs: () => {
        calls.push('renderer')
      },
      run: () => {
        throw Error('Synthetic unresponsive renderer')
      },
    }
    const server = {
      kill: vi.fn(async () => {
        calls.push('server')
      }),
    }
    const run = new Function(
      'vault',
      'sync',
      'server',
      'rmSync',
      'existsSync',
      'expect',
      `return (async()=>{const workspace='';${body}})()`
    )
    await run(vault, sync, server, vi.fn(), () => false, expect)
    expect(calls[0]).toBe('dispose')
    expect(vault.dispose).toHaveBeenCalledOnce()
    expect(server.kill).toHaveBeenCalledOnce()
  })
})
