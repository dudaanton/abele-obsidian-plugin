/**
 * Words selected in a discussion comment, asked about: a real mouse drag over a comment of the fake
 * GitHub's discussion brings up the bar over the words, and its "Ask here" opens a new chat whose
 * input holds a link to that exact comment with the words quoted under it — nothing sent.
 *
 * Only the app can say this: happy-dom lays nothing out, so neither where the bar lands nor
 * whether a drag's selection survives the press on it can be seen in a component test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import {
  PRELUDE,
  enableGithub,
  evalAsync,
  realClick,
  realDrag,
  restoreGithub,
  startFakeGithub,
  type FakeGithub,
} from './helpers/githubLive'
import { DISCUSSION } from './helpers/fakeGithubRepo'

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('words selected in a discussion comment', () => {
  let gh: FakeGithub

  beforeAll(async () => {
    gh = await startFakeGithub()
    enableGithub(gh.origin)
    // "Ask here" is offered with the AI side on; turned on in memory for the run.
    evalAsync(`(async () => {
      ${PRELUDE}
      for (const l of githubLeaves()) l.detach()
      const config = window.__abeleTest.AbeleConfig.getInstance()
      window.__abeleProseE2E = { ai: config.ai?.enabled }
      if (config.ai) config.ai.enabled = true
      return {}
    })()`)
  }, 60_000)

  afterAll(() => {
    if (!available) return
    try {
      evalAsync(`(async () => {
        const saved = window.__abeleProseE2E
        const config = window.__abeleTest.AbeleConfig.getInstance()
        if (saved && config.ai) config.ai.enabled = saved.ai
        const input = document.querySelector('.abele-chat-input__textarea')
        if (input) { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })) }
        window.getSelection().removeAllRanges()
        // The chat opened the right sidebar; it goes back the way the run found it.
        if (window.__abeleGithubE2E?.right) app.workspace.rightSplit.collapse()
        delete window.__abeleProseE2E
        return {}
      })()`)
      restoreGithub()
    } finally {
      gh?.stop()
    }
  }, 60_000)

  it('"Ask here" on the bar opens a chat with the comment\'s link and the words quoted', () => {
    const url = `${gh.web}/discussions/${DISCUSSION}`
    const setup = evalAsync<{
      error?: string
      from?: { x: number; y: number }
      to?: { x: number; y: number }
    }>(`(async () => {
      ${PRELUDE}
      const leaf = await openTab(${JSON.stringify(url)})
      const root = leaf.view.containerEl
      if (!(await until(() => loaded(leaf, 'How should paging work?'), 20000)))
        return { error: 'the discussion never showed' }
      const p = await until(() => [...root.querySelectorAll('.abele-github-comment__body p')]
        .find((p) => p.textContent.startsWith('Fifty reads better')), 15000)
      if (!p) return { error: 'no comment paragraph' }
      p.scrollIntoView({ block: 'center' })
      await wait(400)
      const text = p.firstChild
      const box = (i) => {
        const r = document.createRange()
        r.setStart(text, i)
        r.setEnd(text, i + 1)
        return r.getBoundingClientRect()
      }
      // "reads better": from its first letter to its last.
      const start = text.data.indexOf('reads')
      const end = text.data.indexOf('better') + 'better'.length - 1
      const a = box(start), b = box(end)
      return {
        from: { x: Math.round(a.left + 1), y: Math.round(a.top + a.height / 2) },
        to: { x: Math.round(b.right - 1), y: Math.round(b.top + b.height / 2) },
      }
    })()`)
    expect(setup.error).toBeUndefined()

    realDrag(setup.from!, setup.to!)

    const bar = evalAsync<{
      error?: string
      selected?: string
      ask?: { x: number; y: number }
      above?: boolean
    }>(`(async () => {
      ${PRELUDE}
      const root = githubLeaves()[0].view.containerEl
      const bar = await until(() => root.querySelector('.abele-github-prose_placed'), 5000)
      if (!bar) return { error: 'no bar over the selection', selected: String(window.getSelection()) }
      const button = [...bar.querySelectorAll('button')].find((b) => b.textContent.includes('Ask here'))
      if (!button) return { error: 'no Ask here on the bar' }
      const r = button.getBoundingClientRect()
      const sel = window.getSelection().getRangeAt(0).getBoundingClientRect()
      return {
        selected: String(window.getSelection()),
        ask: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) },
        above: bar.getBoundingClientRect().bottom <= sel.top + 1,
      }
    })()`)
    expect(bar.error).toBeUndefined()
    expect(bar.selected).toBe('reads better')
    expect(bar.above).toBe(true)

    realClick(bar.ask!.x, bar.ask!.y)

    const chat = evalAsync<{ error?: string; text?: string; focused?: boolean }>(`(async () => {
      ${PRELUDE}
      const input = await until(() => {
        const i = document.querySelector('.abele-chat-input__textarea')
        return i && i.value.includes('discussioncomment') ? i : null
      }, 8000)
      if (!input) return { error: 'the chat input never got the link' }
      await wait(300)
      return { text: input.value, focused: document.activeElement === input }
    })()`)
    expect(chat.error).toBeUndefined()
    expect(chat.text).toBe(
      `[acme/widgets#${DISCUSSION} · comment by dave](${gh.web}/discussions/${DISCUSSION}#discussioncomment-301)\n` +
        '> reads better\n\n'
    )
    expect(chat.focused).toBe(true)
  })
})
