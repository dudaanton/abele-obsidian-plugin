/**
 * The GitHub notifications panel in the app, against the fake GitHub server:
 *
 * - the command opens it in the right sidebar, with read and unread inbox rows;
 * - a click on the pull request's opens it in a tab at the latest comment and leaves it unread;
 *   its check marks the thread Done on the server (DELETE), removing it from the inbox;
 * - a discussion, which GitHub names by title only, is found and opened in a tab;
 * - Unread filters the read row out, All restores it, the repository filter narrows, and "mark all as
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
import { shotDir } from './helpers/shots'
import { onPhone, targets } from './helpers/target'

targets('desktop', 'phone')

const SHOTS = shotDir('abele-github-notifications')
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
    // On a real phone the harness's host takes the picture (see helpers/phone.ts).
    if (window.__e2eHost) return await window.__e2eHost.shot(${JSON.stringify(SHOTS)} + '/' + file)
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

/**
 * Sets the notifications panel's own token — a classic one, which is what the fake server, like
 * GitHub, reads notifications with — in memory, beside the main token `enableGithub` put in.
 * `restoreGithub` puts the settings and the keychain back.
 */
const useNotificationsToken = () =>
  evalRaw(
    `(() => {
      const config = window.__abeleTest.AbeleConfig.getInstance()
      config.github = { ...config.github, notifications: { keyId: 'abele-e2e-github-notifications' } }
      const before = app.secretStorage.getSecret
      app.secretStorage.getSecret = function (id) {
        return id === 'abele-e2e-github-notifications' ? 'ghp_e2e_classic' : before.call(this, id)
      }
      config.version.value++
      return 'ok'
    })()`
  )

/**
 * A turn of this worker's event loop: the fake server's log is read only between the blocking
 * calls into the app, so what it answered during one is there after this.
 */
const serverLog = () => new Promise((resolve) => setTimeout(resolve, 300))

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
    // A phone's sidebars are drawers, shut already.
    enableGithub(gh.origin, !onPhone())
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

  it('without a notifications token, says the main token cannot read them and names the field for one', () => {
    const r = evalAsync<{ error?: string; text?: string }>(`(async () => {
      ${PRELUDE}
      ${PANEL}
      app.commands.executeCommandById('abele:show-github-notifications')
      const notice = await until(() => panel()?.querySelector('.abele-github-notice__text'), 20000)
      const text = notice?.textContent ?? ''
      for (const l of app.workspace.getLeavesOfType('abele-github-notifications')) l.detach()
      return notice ? { text } : { error: 'no refusal: ' + (panel()?.textContent.slice(0, 300) ?? 'none') }
    })()`)
    expect(r.error).toBeUndefined()
    expect(r.text).toContain('Notifications token')
    expect(r.text).toContain('classic')
    useNotificationsToken()
  })

  // The old unread-default/check-to-read expectations are intentionally replaced with the
  // documented GitHub inbox contract: read rows stay in All, the check is Done, and opens do not write.
  it('opens in the sidebar with read and unread rows; a click opens the pull request at its comment, and the check marks it Done', async () => {
    const r = evalAsync<{
      error?: string
      inSidebar?: boolean
      onScreen?: boolean
      where?: unknown
      rows?: { id: string; title: string; unread: boolean }[]
      url?: string
      after?: { id: string; unread: boolean }[]
      afterOpen?: { id: string; unread: boolean }[]
      shot?: string
    }>(`(async () => {
      ${PRELUDE}
      ${PANEL}
      if (!(await openPanel())) return { error: 'no panel: ' + (panel()?.textContent.slice(0, 300) ?? 'none') }
      const report = {
        inSidebar: panelLeaf().getRoot() === app.workspace.rightSplit,
        rows: rowsOf(),
      }
      // A phone's drawer slides in first.
      await wait(document.body.classList.contains('is-phone') ? 1000 : 300)
      // Settled: the whole panel inside the screen, not a drawer still sliding.
      await until(() => { const b = panel().getBoundingClientRect(); return b.width > 0 && b.right <= innerWidth + 1 }, 3000)
      const box = panel().getBoundingClientRect()
      report.onScreen = !app.workspace.rightSplit.collapsed && box.width > 0 && box.left < innerWidth
      report.where = { collapsed: app.workspace.rightSplit.collapsed, left: Math.round(box.left), width: Math.round(box.width), screen: innerWidth }
      report.shot = await shoot('desktop-inbox.png')
      panel().querySelector('[data-id="101"] .tree-item-self').click()
      const leaf = await until(() => githubLeaves()[0], 20000)
      if (!leaf) return { ...report, error: 'no tab opened' }
      await until(() => loaded(leaf, 'Rework the widget loader'), 20000)
      report.url = leaf.view.model.url
      await wait(500)
      report.afterOpen = rowsOf().map(({ id, unread }) => ({ id, unread }))
      panel().querySelector('[data-id="101"] .abele-github-notification__mark .abele-obsidian-icon').click()
      await until(() => !rowsOf().some((r) => r.id === '101'), 10000)
      report.after = rowsOf().map(({ id, unread }) => ({ id, unread }))
      return report
    })()`)
    expect(r.error).toBeUndefined()
    expect(r.inSidebar).toBe(true)
    expect(r.onScreen, JSON.stringify(r.where)).toBe(true)
    expect(r.rows).toEqual([
      { id: '101', title: 'Rework the widget loader', unread: true },
      { id: '102', title: 'Loader hangs on an empty list', unread: true },
      { id: '103', title: 'How should paging work?', unread: true },
      { id: '104', title: 'An old question', unread: false },
    ])
    expect(r.url).toBe(`${gh.web}/pull/${PULL}#issuecomment-${LATE_COMMENT}`)
    expect(r.afterOpen).toEqual([
      { id: '101', unread: true },
      { id: '102', unread: true },
      { id: '103', unread: true },
      { id: '104', unread: false },
    ])
    expect(r.after).toEqual([
      { id: '102', unread: true },
      { id: '103', unread: true },
      { id: '104', unread: false },
    ])
    await serverLog()
    // Once, by the check; opening asked nothing of the kind.
    expect(gh.requests().filter((l) => l.startsWith('PATCH '))).toEqual([])
    expect(gh.requests().filter((l) => l.startsWith('DELETE '))).toEqual([
      'DELETE /api/v3/notifications/threads/101',
    ])
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

  it('filters Unread and All, narrows to a repository, marks everything read without Done, then finishes a read row', async () => {
    const r = evalAsync<{
      error?: string
      all?: string[]
      repos?: string[]
      narrowed?: string[]
      afterAll?: boolean
      afterRead?: string[]
      afterDone?: string[]
      shot?: string
    }>(`(async () => {
      ${PRELUDE}
      ${PANEL}
      if (!(await openPanel())) return { error: 'no panel' }
      panel().querySelectorAll('.abele-github-notifications__which .abele-tabs__tab')[0].click()
      if (!(await until(() => ready() && rowsOf().length === 2, 20000)))
        return { error: 'unread never showed: ' + JSON.stringify(rowsOf()) }
      panel().querySelectorAll('.abele-github-notifications__which .abele-tabs__tab')[1].click()
      if (!(await until(() => ready() && rowsOf().length === 3, 20000)))
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
      await until(() => rowsOf().length === 3, 5000)
      panel().querySelector('.abele-github-notifications__read-all').click()
      report.afterAll = !!(await until(() => rowsOf().every((r) => !r.unread), 10000))
      report.afterRead = rowsOf().map((r) => r.id)
      report.shot = await shoot('desktop-all.png')
      panel().querySelector('[data-id="104"] .abele-github-notification__mark .abele-obsidian-icon').click()
      await until(() => !rowsOf().some((r) => r.id === '104'), 10000)
      report.afterDone = rowsOf().map((r) => r.id)
      return report
    })()`)
    expect(r.error).toBeUndefined()
    expect(r.all).toEqual(['102', '103', '104'])
    expect(r.repos).toEqual(['All repositories', 'acme/widgets (2)', 'other/gadgets (1)'])
    expect(r.narrowed).toEqual(['104'])
    expect(r.afterAll).toBe(true)
    expect(r.afterRead).toEqual(['102', '103', '104'])
    expect(r.afterDone).toEqual(['102', '103'])
    await serverLog()
    expect(gh.requests()).toContain('DELETE /api/v3/notifications/threads/104')
    expect(gh.requests()).toContain('PUT /api/v3/notifications')
    // Asked again for a list that had not changed, it was answered "not modified".
    expect(
      gh.requests().filter((l) => l.startsWith('GET /api/v3/notifications')).length
    ).toBeGreaterThan(1)
  })
})

// Emulated in a phone-sized desktop window; a real phone runs the file above as it is.
describe.skipIf(!available || onPhone())('GitHub notifications on a phone', () => {
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
    useNotificationsToken()
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
      measuring?: { visibility: string; opacity: string }[]
      shot?: string
      opened?: string
      drawerClosed?: boolean
    }>(`(async () => {
      ${PRELUDE}
      ${PANEL}
      const report = { phone: document.body.classList.contains('is-phone') }
      if (!(await openPanel())) return { ...report, error: 'no panel: ' + (panel()?.textContent.slice(0, 600) ?? 'none') }
      await wait(800)
      const root = panel()
      const content = panelLeaf().view.contentEl
      const edge = Math.min(content.getBoundingClientRect().right, window.innerWidth)
      const name = (el) => el.tagName.toLowerCase() + '.' + [...el.classList].join('.')
      report.over = [...content.querySelectorAll('*')]
        .filter((el) => {
          // Obsidian's hidden dropdown measuring clone has a box but paints nothing. Measure
          // visible overflow, as the other phone-layout probes do, rather than that clone.
          if (getComputedStyle(el).visibility === 'hidden') return false
          const b = el.getBoundingClientRect()
          return b.width > 0 && b.right > edge + 1
        })
        .map((el) => name(el) + ' +' + Math.round(el.getBoundingClientRect().right - edge))
        .slice(0, 12)
      report.sideways = content.scrollWidth - content.clientWidth
      report.measuring = [...content.querySelectorAll('.is-measuring')].map((el) => {
        const s = getComputedStyle(el)
        return { visibility: s.visibility, opacity: s.opacity }
      })
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
    expect(r.measuring?.every((s) => s.visibility === 'hidden')).toBe(true)
    expect(r.over, JSON.stringify(r.measuring)).toEqual([])
    expect(r.sideways).toBe(0)
    expect(r.opened).toMatch(/\/issues\/7#issuecomment-7011$/)
    expect(r.drawerClosed).toBe(true)
  })
})
