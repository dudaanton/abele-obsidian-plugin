/**
 * The GitHub notifications panel in the app, against the fake GitHub server:
 *
 * - the command opens it in the right sidebar, with the unread ones from the server;
 * - a click on the pull request's opens it in a tab at the latest comment, and marks the thread
 *   read on the server (a PATCH);
 * - a discussion, which GitHub names by title only, is found and opened in a tab;
 * - "All" shows the read one, the repository filter narrows to one repository, and "mark all as
 *   read" PUTs and leaves nothing unread;
 * - on a phone (`emulateMobile`) the panel fits the screen and a row still opens its item.
 *
 * Pictures go to `/tmp/abele-github-notifications/` — look at them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import {
  PRELUDE,
  enableGithub,
  evalAsync,
  restoreGithub,
  startFakeGithub,
  type FakeGithub,
} from './helpers/githubLive'
import { LATE_COMMENT, PULL } from './helpers/fakeGithubRepo'

const SHOTS = '/tmp/abele-github-notifications'
const PHONE = { width: 390, height: 844 }
const available = isObsidianRunning() && hasTestApi()

const PANEL = `
  const panelLeaf = () => app.workspace.getLeavesOfType('abele-github-notifications')[0]
  const panel = () => panelLeaf()?.view.containerEl
  const rowsOf = () => [...(panel()?.querySelectorAll('.abele-github-notification') ?? [])].map((r) => ({
    id: r.dataset.id,
    title: r.querySelector('.abele-github-notification__title').textContent.trim(),
    unread: r.classList.contains('is-unread'),
  }))
  const ready = () => !!panel() && !panel().textContent.includes('Loading from GitHub')
  const openPanel = async () => {
    app.commands.executeCommandById('abele:show-github-notifications')
    return await until(() => ready() && rowsOf().length, 20000)
  }
  const shoot = async (file) => {
    require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const capture = require('@electron/remote').getCurrentWebContents().capturePage()
        const img = await Promise.race([capture, wait(8000).then(() => null)])
        if (img) {
          require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/' + file, img.toPNG())
          return ${JSON.stringify(SHOTS)} + '/' + file
        }
      } catch (e) {
        await wait(500)
      }
    }
    return 'no picture'
  }
`

/** Closes the panel and the GitHub tabs, and folds the right sidebar the panel opened. */
const closeAll = () =>
  evalRaw(
    `(() => {
      for (const t of ['abele-github-notifications', 'abele-github'])
        for (const l of app.workspace.getLeavesOfType(t)) l.detach()
      app.workspace.rightSplit.collapse()
      return 'ok'
    })()`
  )

describe.skipIf(!available)('GitHub notifications', () => {
  let gh: FakeGithub

  beforeAll(async () => {
    gh = await startFakeGithub()
    enableGithub(gh.origin)
  }, 60_000)

  afterAll(() => {
    if (!available) return
    try {
      closeAll()
      restoreGithub()
    } finally {
      gh?.stop()
    }
  })

  it('opens in the sidebar with the unread ones, and a click opens the pull request at its comment and marks it read', () => {
    const r = evalAsync<{
      error?: string
      inSidebar?: boolean
      rows?: { id: string; title: string; unread: boolean }[]
      url?: string
      after?: { id: string; unread: boolean }[]
      shot?: string
    }>(`(async () => {
      ${PRELUDE}
      ${PANEL}
      if (!(await openPanel())) return { error: 'no panel: ' + (panel()?.textContent.slice(0, 300) ?? 'none') }
      const report = {
        inSidebar: panelLeaf().getRoot() === app.workspace.rightSplit,
        rows: rowsOf(),
      }
      await wait(300)
      report.shot = await shoot('desktop-unread.png')
      panel().querySelector('[data-id="101"] .tree-item-self').click()
      const leaf = await until(() => githubLeaves()[0], 20000)
      if (!leaf) return { ...report, error: 'no tab opened' }
      await until(() => loaded(leaf, 'Rework the widget loader'), 20000)
      report.url = leaf.view.model.url
      await until(() => rowsOf().find((r) => r.id === '101' && !r.unread), 10000)
      report.after = rowsOf().map(({ id, unread }) => ({ id, unread }))
      return report
    })()`)
    expect(r.error).toBeUndefined()
    expect(r.inSidebar).toBe(true)
    expect(r.rows).toEqual([
      { id: '101', title: 'Rework the widget loader', unread: true },
      { id: '102', title: 'Loader hangs on an empty list', unread: true },
      { id: '103', title: 'How should paging work?', unread: true },
    ])
    expect(r.url).toBe(`${gh.web}/pull/${PULL}#issuecomment-${LATE_COMMENT}`)
    expect(r.after).toEqual([
      { id: '101', unread: false },
      { id: '102', unread: true },
      { id: '103', unread: true },
    ])
    expect(gh.requests()).toContain('PATCH /api/v3/notifications/threads/101')
    expect(r.shot).toMatch(/\.png$/)
  })

  it('finds a discussion by its title and opens it in a tab', () => {
    const r = evalAsync<{ error?: string; url?: string }>(`(async () => {
      ${PRELUDE}
      ${PANEL}
      if (!(await openPanel())) return { error: 'no panel' }
      panel().querySelector('[data-id="103"] .tree-item-self').click()
      const leaf = await until(() => githubLeaves().find((l) => l.view.model.url.includes('/discussions/')), 20000)
      return leaf ? { url: leaf.view.model.url } : { error: 'no discussion tab: ' + JSON.stringify(tabs()) }
    })()`)
    expect(r.error).toBeUndefined()
    expect(r.url).toBe(`${gh.web}/discussions/3`)
  })

  it('shows read ones under "All", narrows to a repository, and marks everything read', () => {
    const r = evalAsync<{
      error?: string
      all?: string[]
      repos?: string[]
      narrowed?: string[]
      afterAll?: boolean
      shot?: string
    }>(`(async () => {
      ${PRELUDE}
      ${PANEL}
      if (!(await openPanel())) return { error: 'no panel' }
      panel().querySelectorAll('.abele-github-notifications__which .abele-tabs__tab')[1].click()
      if (!(await until(() => ready() && rowsOf().length === 4, 20000)))
        return { error: 'all never showed: ' + JSON.stringify(rowsOf()) }
      const report = { all: rowsOf().map((r) => r.id) }
      const select = panel().querySelector('.abele-github-notifications__repo select')
      report.repos = [...select.options].map((o) => o.textContent)
      select.value = 'other/gadgets'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await until(() => rowsOf().length === 1, 5000)
      report.narrowed = rowsOf().map((r) => r.id)
      select.value = ''
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await until(() => rowsOf().length === 4, 5000)
      panel().querySelector('.abele-github-notifications__read-all').click()
      report.afterAll = !!(await until(() => rowsOf().every((r) => !r.unread), 10000))
      report.shot = await shoot('desktop-all.png')
      return report
    })()`)
    expect(r.error).toBeUndefined()
    expect(r.all).toEqual(['101', '102', '103', '104'])
    expect(r.repos).toEqual(['All repositories', 'acme/widgets (3)', 'other/gadgets (1)'])
    expect(r.narrowed).toEqual(['104'])
    expect(r.afterAll).toBe(true)
    expect(gh.requests()).toContain('PUT /api/v3/notifications')
    // Asked again for a list that had not changed, it was answered "not modified".
    expect(
      gh.requests().filter((l) => l.startsWith('GET /api/v3/notifications')).length
    ).toBeGreaterThan(1)
  })
})

describe.skipIf(!available)('GitHub notifications on a phone', () => {
  let gh: FakeGithub
  let size: [number, number] = [0, 0]

  const setWindowSize = async (width: number, height: number) => {
    evalRaw(
      `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
      30_000
    )
    await new Promise((r) => setTimeout(r, 1500))
  }

  beforeAll(async () => {
    gh = await startFakeGithub()
    size = evalJson<[number, number]>(
      `require('@electron/remote').getCurrentWindow().getContentSize()`
    )
    await reloadApp('app.emulateMobile(true)')
    await setWindowSize(PHONE.width, PHONE.height)
    await reloadApp('window.location.reload()')
    enableGithub(gh.origin, false)
  }, 300_000)

  afterAll(async () => {
    if (!available) return
    try {
      closeAll()
      restoreGithub()
    } finally {
      gh?.stop()
    }
    if (size[0]) await setWindowSize(size[0], size[1])
    await reloadApp('app.emulateMobile(false)')
  }, 180_000)

  it('fits the screen, and a row opens its item', () => {
    const r = evalAsync<{
      error?: string
      phone?: boolean
      over?: string[]
      sideways?: number
      shot?: string
      opened?: string
      drawerClosed?: boolean
    }>(`(async () => {
      ${PRELUDE}
      ${PANEL}
      const report = { phone: document.body.classList.contains('is-phone') }
      if (!(await openPanel())) return { ...report, error: 'no panel' }
      await wait(800)
      const root = panel()
      const content = panelLeaf().view.contentEl
      const edge = Math.min(content.getBoundingClientRect().right, window.innerWidth)
      const name = (el) => el.tagName.toLowerCase() + '.' + [...el.classList].join('.')
      report.over = [...content.querySelectorAll('*')]
        .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.right > edge + 1 })
        .map((el) => name(el) + ' +' + Math.round(el.getBoundingClientRect().right - edge))
        .slice(0, 12)
      report.sideways = content.scrollWidth - content.clientWidth
      report.shot = await shoot('phone.png')
      root.querySelector('[data-id="102"] .tree-item-self').click()
      const leaf = await until(() => githubLeaves()[0], 20000)
      if (!leaf) return { ...report, error: 'no tab opened' }
      await until(() => loaded(leaf, 'Loader hangs on an empty list'), 20000)
      report.opened = leaf.view.model.url
      await wait(800)
      report.drawerClosed = app.workspace.rightSplit.collapsed
      await shoot('phone-opened.png')
      return report
    })()`)
    expect(r.error).toBeUndefined()
    expect(r.phone).toBe(true)
    expect(r.over).toEqual([])
    expect(r.sideways).toBe(0)
    expect(r.opened).toMatch(/\/issues\/7#issuecomment-7011$/)
    expect(r.drawerClosed).toBe(true)
  })
})
