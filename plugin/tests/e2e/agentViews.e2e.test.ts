import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const SHOTS = shotDir('agent-views')
const available = isObsidianRunning() && hasTestApi()
const picture =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" fill="#eee"/><path d="M85 35h70v70H85zM80 105h80v12H80zM85 117v40m70-40v40" fill="#999" stroke="#777" stroke-width="8"/></svg>'
  )
const cards =
  '<div class="cards">' +
  ['Oak chair', 'Desk chair', 'Reading chair']
    .map(
      (name, i) =>
        `<article class="card"><img src="${picture}" alt="${name}"><div class="body"><div class="title">${name}</div><div class="meta">Sample comparison · natural finish</div><div class="price">${120 + i * 30} EUR</div><div class="actions"><a class="button" href="https://example.test/chair">Details</a><a class="button accent" href="abele:ask?text=Compare%20chairs">Compare</a></div></div></article>`
    )
    .join('') +
  '</div>'

describe.skipIf(!available)('agent views in a real chat answer', () => {
  it.each(['desktop', 'phone emulation'])(
    'renders cards and broken source on %s',
    async (layout) => {
      const run = async () =>
        JSON.parse(
          await evalLong(
            `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms))
      const until = async fn => { for (let i = 0; i < 100; i++) { const value = fn(); if (value) return value; await wait(100) } throw Error('Agent view did not render') }
      const chats = window.__abeleTest.ChatService.getInstance()
      const previous = chats.activeTabId.value
      const previousLeaf = app.workspace.activeLeaf
      const path = 'sample-agent-views.abchat'
      if (app.vault.getAbstractFileByPath(path)) throw Error('Synthetic path occupied')
      if (!chats.canCreateTab) throw Error('No free synthetic chat tab')
      let file, tab
      const panes = new Set(app.workspace.getLeavesOfType('abele-ai-sidebar-view'))
      const capture = async name => {
        await wait(300)
        const image = await require('@electron/remote').getCurrentWebContents().capturePage()
        require('fs').writeFileSync(${JSON.stringify(SHOTS + '/')} + ${JSON.stringify(layout.replaceAll(' ', '-'))} + '-' + name + '.png', image.toPNG())
      }
      try {
        const records = [
          { v: 2, k: 'meta', type: 'abele-chat', title: 'Sample chair comparison', created: '2024-01-01', activeLeafId: 'answer' },
          { k: 'msg', id: 'question', role: 'user', content: 'Compare three sample chairs', timestamp: 1704067200000 },
          { k: 'msg', id: 'answer', parentId: 'question', role: 'assistant', content: ${JSON.stringify('```abele-view\n' + cards + '\n```\n\n```abele-view\n<script>parent.__agentViewExecuted = true</script>\n```')}, timestamp: 1704067201000 },
        ]
        file = await app.vault.create(path, records.map(r => JSON.stringify(r)).join('\\n') + '\\n')
        tab = chats.createTab()
        await chats.openChatInTab(tab, file)
        await chats.revealSidebar({ focus: false })
        const frame = await until(() => [...document.querySelectorAll('.abele-agent-view iframe')].find(el => el.getClientRects().length && el.contentDocument?.querySelectorAll('.card').length === 3))
        await until(() => frame.getBoundingClientRect().height > 40)
        frame.scrollIntoView({ block: 'center' })
        await capture('chairs')
        const doc = frame.contentDocument
        const cardCount = doc.querySelectorAll('.card').length
        const overflow = doc.documentElement.scrollWidth > frame.clientWidth + 1
        const sandbox = frame.getAttribute('sandbox')
        const appearance = {
          font: doc.defaultView.getComputedStyle(doc.body).fontFamily,
          gap: doc.defaultView.getComputedStyle(doc.querySelector('.cards')).gap,
          border: doc.defaultView.getComputedStyle(doc.querySelector('.card')).borderTopWidth,
          clipped: [...doc.querySelectorAll('.card')].some(card => [...card.querySelectorAll('.title, .button')].some(el => el.getBoundingClientRect().right > card.getBoundingClientRect().right + 1)),
          theme: frame.srcdoc.match(/:root \\{ ([\\s\\S]*?) \\}/)?.[1],
          hostFont: getComputedStyle(document.body).getPropertyValue('--font-interface'),
          hostShadow: getComputedStyle(document.body).getPropertyValue('--shadow-s'),
        }
        const broken = await until(() => document.querySelector('.abele-agent-view__broken'))
        broken.scrollIntoView({ block: 'center' })
        await capture('broken')
        // Deliberately bypass sanitizing to prove the browser boundaries on this same frame.
        const hostile = '<script>parent.__agentViewExecuted = true</script><img src="data:image/png,invalid" onerror="parent.__agentViewExecuted = true"><svg onload="parent.__agentViewExecuted = true"></svg>'
        for (const source of [frame.srcdoc.replace('</body>', hostile + '</body>'), hostile]) {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(Error('Sandbox probe did not load')), 5000)
            frame.addEventListener('load', () => { clearTimeout(timer); resolve() }, { once: true })
            frame.srcdoc = source
          })
          await wait(150)
          if (window.__agentViewExecuted === true) throw Error('Frame executed agent content')
        }
        return { cardCount, overflow, sandbox, appearance, executed: window.__agentViewExecuted === true, broken: broken.textContent, source: broken.parentElement.querySelector('code').textContent }
      } finally {
        if (tab) await chats.closeTab(tab)
        if (previous) chats.switchTab(previous)
        for (const leaf of app.workspace.getLeavesOfType('abele-ai-sidebar-view')) if (!panes.has(leaf)) leaf.detach()
        if (previousLeaf?.view.containerEl.isConnected) app.workspace.setActiveLeaf(previousLeaf, { focus: false })
        if (file) await app.vault.delete(file)
        delete window.__agentViewExecuted
      }
    })()`,
            60_000
          )
        )
      const result = layout === 'desktop' ? await run() : await withEmulatedPhone(run)
      console.log('Agent view appearance', layout, result.appearance)
      expect(parseFloat(result.appearance.gap)).toBeGreaterThan(0)
      expect(parseFloat(result.appearance.border)).toBeGreaterThan(0)
      expect(result.appearance.clipped).toBe(false)
      expect(result.appearance.font).not.toContain('Times')
      expect(result.cardCount).toBe(3)
      expect(result.overflow).toBe(false)
      expect(result.sandbox).toBe('allow-same-origin')
      expect(result.executed).toBe(false)
      expect(result.broken).toContain('can’t be shown')
      expect(result.source).toContain('<script>')
    },
    180_000
  )
})
