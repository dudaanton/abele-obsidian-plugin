/**
 * A repository's front page in the app, against the fake GitHub server:
 *
 * - the repository's address opens its front page — what it says of itself, its languages, the
 *   freshest open pull request and issue, the latest release, its files and README rendered;
 * - a pull request on it opens in the same tab, and back returns to the page;
 * - the branch and tag switcher moves the page to the tag, whose README is the older one;
 * - "Open GitHub repository…" offers the account's own and starred repositories, and a choice
 *   opens the front page;
 *
 * and a picture of the page goes to `/tmp/abele-github-home/` — look at it. The phone's is in
 * `githubPhone.e2e.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import {
  PRELUDE,
  enableGithub,
  evalAsync,
  restoreGithub,
  startFakeGithub,
  type FakeGithub,
} from './helpers/githubLive'
import { OWNER, REPO, TAG } from './helpers/fakeGithubRepo'

const SHOTS = '/tmp/abele-github-home'
const available = isObsidianRunning() && hasTestApi()

const HOME = `
  const home = (root) => root.querySelector('.abele-github-home')
  const listRows = (root, list) => [...root.querySelectorAll('[data-list="' + list + '"] .tree-item-self')]
    .map((r) => r.textContent.trim())
  const homeLoaded = (leaf) => {
    const root = leaf?.view.containerEl
    return !!root && !!home(root) && !!root.querySelector('.abele-github-folder__readme h1') &&
      listRows(root, 'pulls').length > 0
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

/** Helpers for a script that drives "Open GitHub repository…"; goes after `PRELUDE`. */
const PICKER = `
  const picker = () => document.querySelector('.abele-github-repos')
  const input = () => picker()?.querySelector('input')
  const rows = () => [...(picker()?.querySelectorAll('.suggestion-item') ?? [])].map((el) => ({
    title: el.querySelector('.suggestion-title')?.textContent ?? '',
    kind: el.querySelector('.suggestion-hotkey')?.textContent ?? '',
  }))
`

describe.skipIf(!available)("a repository's front page", () => {
  let gh: FakeGithub

  beforeAll(async () => {
    gh = await startFakeGithub()
    enableGithub(gh.origin)
  }, 60_000)

  afterEach(() => {
    evalRaw(
      `(() => { for (const l of app.workspace.getLeavesOfType('abele-github')) l.detach(); return 'ok' })()`
    )
  })

  afterAll(() => {
    if (!available) return
    try {
      restoreGithub()
    } finally {
      gh?.stop()
    }
  })

  it('shows what the repository says of itself, its lists, its files and README', () => {
    const r = evalAsync<{
      error?: string
      title?: string
      ref?: string
      about?: string
      languages?: string[]
      pulls?: string[]
      issues?: string[]
      release?: string[]
      files?: string[]
      readme?: string
      tabTitle?: string
      shot?: string
    }>(`(async () => {
      ${PRELUDE}
      ${HOME}
      const leaf = await openTab(${JSON.stringify(gh.web)})
      const root = leaf.view.containerEl
      if (!(await until(() => homeLoaded(leaf) && listRows(root, 'release').length, 20000)))
        return { error: 'the page never loaded: ' + root.textContent.slice(0, 300) }
      await wait(500)
      return {
        title: root.querySelector('.abele-github-header__title').textContent.replace(/\\s+/g, ' ').trim(),
        ref: root.querySelector('.abele-github-home__ref').textContent.trim(),
        about: root.querySelector('.abele-github-home__about').textContent.replace(/\\s+/g, ' ').trim(),
        languages: [...root.querySelectorAll('.abele-github-home__lang-name')].map((l) => l.textContent),
        pulls: listRows(root, 'pulls'),
        issues: listRows(root, 'issues'),
        release: listRows(root, 'release'),
        files: [...root.querySelectorAll('.abele-github-folder .tree-item-self')].map((r) => r.getAttribute('data-path')),
        readme: root.querySelector('.abele-github-folder__readme h1').textContent,
        tabTitle: leaf.getDisplayText(),
        shot: await shoot('desktop-home.png'),
      }
    })()`)
    expect(r.error).toBeUndefined()
    expect(r.title).toContain(`${OWNER}`)
    expect(r.title).toContain(`${REPO}`)
    expect(r.ref).toBe('main')
    expect(r.about).toContain('Widgets for the dashboard, loaded in pages.')
    expect(r.about).toContain('1.2k stars')
    expect(r.about).toContain('MIT')
    expect(r.languages).toEqual(['TypeScript', 'CSS', 'Shell'])
    expect(r.pulls).toEqual(['Rework the widget loader#42'])
    expect(r.issues).toEqual(['Loader hangs on an empty list#7'])
    expect(r.release?.[0]).toContain('Widgets 1.0')
    expect(r.files).toEqual(['src', 'README.md'])
    expect(r.readme).toBe('Widgets')
    expect(r.tabTitle).toBe(`${OWNER}/${REPO}`)
    expect(r.shot).toMatch(/\.png$/)
  })

  it('opens a pull request from it in the same tab, and back returns to it', () => {
    const r = evalAsync<{ error?: string; pullUrl?: string; backUrl?: string; tabs?: number }>(
      `(async () => {
        ${PRELUDE}
        ${HOME}
        const leaf = await openTab(${JSON.stringify(gh.web)})
        const root = leaf.view.containerEl
        if (!(await until(() => homeLoaded(leaf), 20000))) return { error: 'no page' }
        root.querySelector('[data-list="pulls"] .tree-item-self').click()
        if (!(await until(() => loaded(leaf, 'Rework the widget loader'), 20000)))
          return { error: 'the pull request never opened' }
        const pullUrl = leaf.view.model.url
        await leaf.history.back()
        await until(() => homeLoaded(leaf), 20000)
        return { pullUrl, backUrl: leaf.view.model.url, tabs: githubLeaves().length }
      })()`
    )
    expect(r.error).toBeUndefined()
    expect(r.pullUrl).toBe(`${gh.web}/pull/42`)
    expect(r.backUrl).toBe(gh.web)
    expect(r.tabs).toBe(1)
  })

  it('switches to a tag, whose files and README follow, and back to the default branch', () => {
    const r = evalAsync<{
      error?: string
      offered?: string[]
      url?: string
      ref?: string
      readme?: string
      backUrl?: string
    }>(`(async () => {
      ${PRELUDE}
      ${HOME}
      const leaf = await openTab(${JSON.stringify(gh.web)})
      const root = leaf.view.containerEl
      if (!(await until(() => homeLoaded(leaf), 20000))) return { error: 'no page' }
      root.querySelector('.abele-github-home__ref').click()
      const modal = () => document.querySelector('.abele-github-refs')
      const items = () => [...(modal()?.querySelectorAll('.suggestion-item') ?? [])]
      if (!(await until(() => items().length >= 4, 10000)))
        return { error: 'no switcher: ' + (modal()?.textContent ?? 'none') }
      const offered = items().map((el) => el.querySelector('.suggestion-title').textContent)
      items().find((el) => el.querySelector('.suggestion-title').textContent === ${JSON.stringify(TAG)}).click()
      const moved = await until(() => leaf.view.model.url.endsWith('/tree/${TAG}') && homeLoaded(leaf) &&
        root.querySelector('.abele-github-folder__readme')?.textContent.includes('Lists are loaded whole'), 20000)
      if (!moved) return { offered, error: 'the page never moved to the tag' }
      const report = {
        offered,
        url: leaf.view.model.url,
        ref: root.querySelector('.abele-github-home__ref').textContent.trim(),
        readme: 'old',
      }
      const back = [...root.querySelectorAll('.abele-github-home__bar button')].find((b) => b.textContent.includes('main'))
      back?.click()
      await until(() => leaf.view.model.url === ${JSON.stringify(gh.web)} && homeLoaded(leaf), 20000)
      return { ...report, backUrl: leaf.view.model.url }
    })()`)
    expect(r.error).toBeUndefined()
    expect(r.offered).toEqual(['main', 'loader', 'feature/paging', TAG])
    expect(r.url).toBe(`${gh.web}/tree/${TAG}`)
    expect(r.ref).toBe(TAG)
    expect(r.backUrl).toBe(gh.web)
  })

  it('"Open GitHub repository…" offers your own and starred ones, and opens the page', () => {
    const r = evalAsync<{ error?: string; rows?: { title: string; kind: string }[]; url?: string }>(
      `(async () => {
        ${PRELUDE}
        ${HOME}
        ${PICKER}
        app.commands.executeCommandById('abele:open-github-repository')
        if (!(await until(() => input(), 5000))) return { error: 'no picker' }
        const listed = await until(() => rows().some((r) => r.kind === 'Starred') ? rows() : null, 15000)
        if (!listed) return { error: 'nothing from the account: ' + JSON.stringify(rows()) }
        const row = [...picker().querySelectorAll('.suggestion-item')]
          .find((el) => el.querySelector('.suggestion-title').textContent === ${JSON.stringify(`${OWNER}/${REPO}`)})
        row.click()
        const leaf = await until(() => githubLeaves().find((l) => l.view.model.url === ${JSON.stringify(gh.web)}), 10000)
        if (!leaf || !(await until(() => homeLoaded(leaf), 20000))) return { rows: listed, error: 'no page' }
        return { rows: listed, url: leaf.view.model.url }
      })()`
    )
    expect(r.error).toBeUndefined()
    expect(r.rows).toEqual(
      expect.arrayContaining([
        { title: `${OWNER}/${REPO}`, kind: expect.stringMatching(/Recent|Yours/) },
        { title: 'other/gadgets', kind: 'Starred' },
      ])
    )
    expect(r.url).toBe(gh.web)
  })
})
