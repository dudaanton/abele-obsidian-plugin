/**
 * The documentation view in the running app, on a desktop and on a phone.
 *
 * happy-dom renders no markdown and computes no layout, so the component tests can only ask
 * which page is on screen. These ask what a person would see: that Obsidian drew the page as
 * markdown, that a link between pages is followed and not drawn as a missing note, that a
 * search result opens its page with the words marked and on screen, and that nothing reaches
 * past the right edge — beside the contents on a desktop, and behind the menu button at a
 * phone's size (390×844, `app.emulateMobile(true)`).
 *
 * Pictures of each screen go to `/tmp/abele-phone/` to be looked at; they are never committed.
 * Requires Obsidian running on a vault with the development build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  evalJson,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  setBackgroundThrottling,
} from './helpers/obsidianCli'

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1600, height: 1000 }
const SHOTS = '/tmp/abele-phone'

interface Screen {
  /** Class names of elements past the right edge of the view, with how far past. */
  over: string[]
  shot: string
  error: string
  [key: string]: unknown
}

type Report = Record<string, Screen>

const evalAsync = <T>(script: string, timeoutMs: number): T =>
  JSON.parse(evalRaw(script, timeoutMs)) as T

/** Shared by both probes: waiting, measuring, the picture, and driving the view. */
const helpers = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (fn()) return true
      await wait(100)
    }
    return false
  }
  const fs = require('fs')
  const win = require('@electron/remote').getCurrentWindow()
  fs.mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
  const name = (el) => ((el.className || el.tagName) + '').split(' ')[0].slice(0, 48)

  const over = (root) => {
    const box = root.getBoundingClientRect()
    const edge = Math.min(box.right, window.innerWidth)
    const out = []
    const walk = (el) => {
      const s = getComputedStyle(el)
      if (s.display === 'none' || s.visibility === 'hidden') return
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.right > edge + 1) out.push(name(el) + ' +' + Math.round(r.right - edge))
      // A code block or a table scrolls sideways within itself, by design.
      if (s.overflowX === 'auto' || s.overflowX === 'scroll') return
      for (const c of el.children) walk(c)
    }
    for (const c of root.children) walk(c)
    return out
  }

  const shoot = async (label) => {
    await wait(400)
    let img
    try {
      img = await win.webContents.capturePage()
    } catch (error) {
      if (!String(error && error.message).includes('UnknownVizError')) throw error
      await wait(300)
      img = await win.webContents.capturePage()
    }
    const path = ${JSON.stringify(SHOTS)} + '/docs-' + label.replace(/[^a-z0-9]+/gi, '-') + '.png'
    fs.writeFileSync(path, img.toPNG())
    return path
  }

  const view = () => document.querySelector('.workspace-leaf.mod-active .abele-user-docs')
    || document.querySelector('.abele-user-docs')
  const article = () => view().querySelector('.abele-user-docs__article')
  const h1 = () => (article().querySelector('h1') || {}).textContent || ''

  const openDocs = async () => {
    for (const leaf of app.workspace.getLeavesOfType('abele-user-docs')) leaf.detach()
    // Right after a reload the plugin may not have registered its commands yet.
    await until(() => app.commands.commands['abele:open-documentation'], 20000)
    app.commands.executeCommandById('abele:open-documentation')
    return until(() => view() && article().querySelector('h1'), 20000)
  }

  const search = async (text) => {
    const input = view().querySelector('.abele-user-docs__nav input')
    input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(300)
  }

  const markOnScreen = () => {
    const mark = article().querySelector('mark.abele-user-docs__mark')
    if (!mark) return false
    const a = article().getBoundingClientRect()
    const m = mark.getBoundingClientRect()
    return m.top >= a.top && m.bottom <= a.bottom
  }
`

const desktopProbe = `(async () => {
  ${helpers}
  const report = {}
  try {
    if (!(await openDocs())) throw new Error('the documentation never opened')
    const links = [...article().querySelectorAll('a.internal-link')]
    report['desktop'] = {
      over: over(view()),
      shot: await shoot('desktop'),
      error: '',
      title: h1(),
      nav: !!view().querySelector('.abele-user-docs__nav'),
      menu: !!view().querySelector('.abele-user-docs__menu'),
      sections: article().querySelectorAll('h2').length,
      links: links.length,
      unresolved: links.filter((a) => a.classList.contains('is-unresolved')).length,
    }

    const notesBefore = app.workspace.getLeavesOfType('markdown').length
    links.find((a) => a.getAttribute('data-href') === 'groups').click()
    await until(() => h1() === 'Groups and the note footer', 5000)
    report['link'] = {
      over: [], shot: '', error: '',
      title: h1(),
      notesOpened: app.workspace.getLeavesOfType('markdown').length - notesBefore,
    }

    await search('passphrase')
    const hits = view().querySelectorAll('.abele-user-docs__hit')
    report['search'] = {
      over: over(view()),
      shot: await shoot('desktop-search'),
      error: '',
      hits: hits.length,
    }
    hits[0].click()
    await until(() => article().querySelector('mark.abele-user-docs__mark'), 5000)
    await wait(300)
    report['result'] = {
      over: over(view()),
      shot: await shoot('desktop-result'),
      error: '',
      title: h1(),
      marked: markOnScreen(),
    }
  } catch (e) {
    report['run'] = { over: [], shot: '', error: String((e && e.message) || e) }
  } finally {
    for (const leaf of app.workspace.getLeavesOfType('abele-user-docs')) leaf.detach()
  }
  return report
})()`

const phoneProbe = `(async () => {
  ${helpers}
  const report = {}
  try {
    if (!(await openDocs())) throw new Error('the documentation never opened')
    report['phone'] = {
      over: over(view()),
      shot: await shoot('phone'),
      error: '',
      title: h1(),
      nav: !!view().querySelector('.abele-user-docs__nav'),
      menu: !!view().querySelector('.abele-user-docs__menu'),
    }

    view().querySelector('.abele-user-docs__menu').click()
    await wait(300)
    report['phone contents'] = {
      over: over(view()),
      shot: await shoot('phone-contents'),
      error: '',
      nav: !!view().querySelector('.abele-user-docs__nav'),
      articleShown: article().offsetParent !== null,
    }

    await search('timer')
    report['phone search'] = {
      over: over(view()),
      shot: await shoot('phone-search'),
      error: '',
      hits: view().querySelectorAll('.abele-user-docs__hit').length,
    }

    view().querySelector('.abele-user-docs__hit').click()
    await until(() => article().offsetParent !== null && article().querySelector('mark.abele-user-docs__mark'), 5000)
    await wait(300)
    report['phone result'] = {
      over: over(view()),
      shot: await shoot('phone-result'),
      error: '',
      nav: !!view().querySelector('.abele-user-docs__nav'),
      marked: markOnScreen(),
    }
  } catch (e) {
    report['run'] = { over: [], shot: '', error: String((e && e.message) || e) }
  } finally {
    for (const leaf of app.workspace.getLeavesOfType('abele-user-docs')) leaf.detach()
  }
  return report
})()`

const setMobile = async (on: boolean): Promise<void> => {
  evalRaw(
    `(() => {
      const close = document.querySelector('.modal-close-button')
      if (close) close.click()
      return 'ok'
    })()`,
    30_000
  )
  await reloadApp(`app.emulateMobile(${on})`)
}

const windowSize = (): [number, number] =>
  evalJson<[number, number]>(
    `require('@electron/remote').getCurrentWindow().getContentSize()`,
    30_000
  )

const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => {
      require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height})
      return 'ok'
    })()`,
    30_000
  )
  await new Promise((resolve) => setTimeout(resolve, 1500))
}

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('the documentation', () => {
  let desktop: Report = {}
  let phone: Report = {}
  let size: [number, number] = [0, 0]

  beforeAll(async () => {
    setBackgroundThrottling(false)
    size = windowSize()
    // Wide enough for the contents and the page side by side between both sidebars: below
    // that the view hides its contents behind the menu button, as it does on a phone.
    await setWindowSize(DESKTOP.width, DESKTOP.height)
    await reloadApp()
    setBackgroundThrottling(false)
    desktop = evalAsync<Report>(desktopProbe, 60_000)

    await setMobile(true)
    await setWindowSize(PHONE.width, PHONE.height)
    setBackgroundThrottling(false)
    phone = evalAsync<Report>(phoneProbe, 60_000)

    const shots = [...Object.values(desktop), ...Object.values(phone)]
      .map((s) => s.shot)
      .filter(Boolean)
    console.info(`\n  ${shots.join('\n  ')}\n`)
  }, 180_000)

  afterAll(async () => {
    if (!available) return
    // The window first: leaving emulation reloads the app at the window's size at that moment.
    if (size[0]) await setWindowSize(size[0], size[1])
    await setMobile(false)
  }, 120_000)

  it('opens on a desktop', () => {
    expect(desktop.run?.error ?? '').toBe('')
    expect(phone.run?.error ?? '').toBe('')
  })

  it('draws the page as markdown, beside the contents', () => {
    expect(desktop.desktop.title).toBe('Getting started')
    expect(desktop.desktop.sections).toBeGreaterThan(2)
    expect(desktop.desktop.nav).toBe(true)
    expect(desktop.desktop.menu).toBe(false)
  })

  it('does not draw a link between pages as a missing note', () => {
    expect(desktop.desktop.links).toBeGreaterThan(0)
    expect(desktop.desktop.unresolved).toBe(0)
  })

  it('follows a link to another page, and opens no note', () => {
    expect(desktop.link.title).toBe('Groups and the note footer')
    expect(desktop.link.notesOpened).toBe(0)
  })

  it('opens a search result with the words marked and on screen', () => {
    expect(desktop.search.hits).toBeGreaterThan(0)
    expect(desktop.result.title).toBe('Transfer and keys')
    expect(desktop.result.marked).toBe(true)
  })

  it('on a phone shows the page, with the contents behind the menu button', () => {
    expect(phone.phone.title).toBe('Getting started')
    expect(phone.phone.nav).toBe(false)
    expect(phone.phone.menu).toBe(true)
    expect(phone['phone contents'].nav).toBe(true)
    expect(phone['phone contents'].articleShown).toBe(false)
  })

  it('on a phone goes back to the page once a result is picked', () => {
    expect(phone['phone search'].hits).toBeGreaterThan(0)
    expect(phone['phone result'].nav).toBe(false)
    expect(phone['phone result'].marked).toBe(true)
  })

  const screens = (): [string, Screen][] =>
    [...Object.entries(desktop), ...Object.entries(phone)].filter(([label]) => label !== 'run')

  it('puts nothing past the right edge of the view, on any screen', () => {
    for (const [label, screen] of screens()) expect(screen.over, label).toEqual([])
  })
})
