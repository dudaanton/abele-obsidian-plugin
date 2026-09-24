/**
 * The "Open GitHub link or item" picker in the app, against the fake GitHub server: what it
 * offers while typing, that GitHub is asked once the typing pauses rather than on every key, and
 * that choosing a row opens the right tab.
 *
 * The picker's repository is the default one from the settings — no GitHub tab is open when it
 * starts. See `helpers/githubLive.ts` for the settings and the server.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw } from './helpers/obsidianCli'
import {
  PRELUDE,
  enableGithub,
  evalAsync,
  restoreGithub,
  startFakeGithub,
  type FakeGithub,
} from './helpers/githubLive'
import { HEAD_SHA, OWNER, REPO } from './helpers/fakeGithubRepo'

const available = isObsidianRunning() && hasTestApi()

interface Rows {
  error?: string
  rows?: { title: string; note: string; kind: string }[]
  empty?: string
}

/** Helpers for a script that drives the picker; goes after `PRELUDE`. */
const PICKER = `
  const picker = () => document.querySelector('.abele-github-open')
  const input = () => picker()?.querySelector('input')
  const openPicker = async () => {
    if (picker()) return true
    app.commands.executeCommandById('abele:open-github-link')
    return !!(await until(() => input(), 5000))
  }
  const type = (text) => {
    input().value = text
    input().dispatchEvent(new Event('input', { bubbles: true }))
  }
  const rows = () => [...picker().querySelectorAll('.suggestion-item')].map((el) => ({
    title: el.querySelector('.suggestion-title')?.textContent ?? '',
    note: el.querySelector('.suggestion-note')?.textContent ?? '',
    kind: el.querySelector('.suggestion-hotkey')?.textContent ?? '',
  }))
  const empty = () => picker()?.querySelector('.suggestion-empty')?.textContent ?? ''
  const settled = () => until(() => picker() && !rows().some((r) => r.title === 'Asking GitHub…') &&
    !empty().includes('Asking GitHub') ? true : null, 10000)
  const closePicker = async () => {
    if (!picker()) return
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
    await until(() => !picker(), 3000)
  }
`

/** Types `text` into a fresh picker and reports what it offers once GitHub has answered. */
const offered = (text: string) =>
  evalAsync<Rows>(`(async () => {
    ${PRELUDE}
    ${PICKER}
    try {
      await closePicker()
      if (!(await openPicker())) return { error: 'no picker' }
      type(${JSON.stringify(text)})
      await wait(100)
      await settled()
      await wait(100)
      return { rows: rows(), empty: empty() }
    } finally {
      await closePicker()
    }
  })()`)

/**
 * Types `text`, waits for a row titled `title`, clicks it, and waits for a GitHub tab showing
 * `url`; reports the address of every GitHub tab.
 */
const choose = (text: string, title: string, url: string) =>
  evalAsync<{ error?: string; urls?: string[] }>(`(async () => {
    ${PRELUDE}
    ${PICKER}
    await closePicker()
    if (!(await openPicker())) return { error: 'no picker' }
    type(${JSON.stringify(text)})
    const row = await until(() => [...picker().querySelectorAll('.suggestion-item')]
      .find((el) => el.querySelector('.suggestion-title')?.textContent === ${JSON.stringify(title)}), 10000)
    if (!row) { const seen = rows(); await closePicker(); return { error: 'no row ' + JSON.stringify(seen) } }
    row.click()
    await until(() => githubLeaves().some((l) => l.view.model.url === ${JSON.stringify(url)}), 10000)
    return { urls: githubLeaves().map((l) => l.view.model.url) }
  })()`)

describe.skipIf(!available)('the Open GitHub link or item picker', () => {
  let gh: FakeGithub

  beforeAll(async () => {
    gh = await startFakeGithub()
    enableGithub(gh.origin)
    evalRaw(
      `(() => {
        for (const l of app.workspace.getLeavesOfType('abele-github')) l.detach()
        const config = window.__abeleTest.AbeleConfig.getInstance()
        config.github = { ...config.github, defaultRepo: ${JSON.stringify(`${OWNER}/${REPO}`)} }
        return 'ok'
      })()`,
      30_000
    )
  }, 60_000)

  afterAll(() => {
    if (!available) return
    try {
      restoreGithub()
    } finally {
      gh?.stop()
    }
  })

  it('offers a number as what it is: a pull request, an issue, a discussion', () => {
    const pull = offered('#42')
    expect(pull.error).toBeUndefined()
    expect(pull.rows?.[0]).toMatchObject({
      title: 'Rework the widget loader',
      kind: 'Pull request',
    })

    expect(offered('7').rows?.[0]).toMatchObject({
      title: 'Loader hangs on an empty list',
      kind: 'Issue',
    })
    expect(offered('#3').rows?.[0]).toMatchObject({
      title: 'How should paging work?',
      kind: 'Discussion',
    })
  })

  it('offers titles, branches and a commit while typing', () => {
    const words = offered('loader')
    expect(words.rows?.map((r) => [r.kind, r.title])).toEqual([
      ['Pull request', 'Rework the widget loader'],
      ['Issue', 'Loader hangs on an empty list'],
      ['Branch', 'loader'],
    ])
    expect(offered('paging').rows?.map((r) => r.title)).toEqual([
      'How should paging work?',
      'feature/paging',
    ])
    expect(offered(HEAD_SHA.slice(0, 7)).rows?.[0]).toMatchObject({
      title: 'Rework the widget loader',
      kind: 'Commit',
    })
  })

  it('says why there is nothing, rather than an empty list', () => {
    expect(offered('https://example.com/a/b/pull/1').empty).toMatch(/example\.com/)
    expect(offered('zzzz nothing').empty).toMatch(/Nothing in acme\/widgets/)
  })

  it('asks GitHub once the typing pauses, not on every key', async () => {
    const result = evalAsync<{ error?: string }>(`(async () => {
      ${PRELUDE}
      ${PICKER}
      try {
        await closePicker()
        if (!(await openPicker())) return { error: 'no picker' }
        for (const text of ['w', 'wi', 'wid', 'widg', 'widget']) { type(text); await wait(60) }
        await wait(100)
        await settled()
        return {}
      } finally {
        await closePicker()
      }
    })()`)
    expect(result.error).toBeUndefined()
    // The server's log is read while this worker is free, which it was not during the eval.
    await new Promise((resolve) => setTimeout(resolve, 500))
    // Only the searches for what was typed here: 'w', 'wi', … 'widget'.
    const typed = gh
      .requests()
      .map((r) => decodeURIComponent(r.replace(/\+/g, ' ')))
      .filter((r) => r.includes('/search/issues'))
      .map((r) => / (w\w*) in:title/.exec(r)?.[1])
      .filter((w) => w && 'widget'.startsWith(w))
    expect(typed).toEqual(['widget'])
  })

  it('opens what is chosen in a GitHub tab', () => {
    const pull = `${gh.web}/pull/42`
    expect(choose('#42', 'Rework the widget loader', pull).urls).toContain(pull)
    const branch = `${gh.web}/tree/feature/paging`
    expect(choose('feature/pa', 'feature/paging', branch).urls).toContain(branch)
    const pasted = `${gh.web}/pull/42/files`
    expect(choose(pasted, `${OWNER}/${REPO}#42`, pasted).urls).toContain(pasted)
  })
})
