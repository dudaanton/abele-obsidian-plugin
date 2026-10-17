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
      const until = async (fn, label = 'render', details = () => ({})) => { for (let i = 0; i < 100; i++) { const value = fn(); if (value) return value; await wait(100) } throw Error('Agent view ' + label + ' timed out: ' + JSON.stringify(await details())) }
      const chats = window.__abeleTest.ChatService.getInstance()
      const previous = chats.activeTabId.value
      const previousLeaf = app.workspace.activeLeaf
      const path = 'sample-agent-views.abchat'
      if (app.vault.getAbstractFileByPath(path)) throw Error('Synthetic path occupied')
      if (!chats.canCreateTab) throw Error('No free synthetic chat tab')
      let file, tab, session, originalSend
      let unexpectedSends = 0
      const originalConsoleError = console.error
      const rendererErrors = []
      console.error = (...args) => { rendererErrors.push(args.map(value => value?.stack || String(value))); originalConsoleError.apply(console, args) }
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
        session = chats.getSession(tab)
        originalSend = session.sendMessage
        session.sendMessage = async () => { unexpectedSends++; throw Error('A view link must never send a message') }
        await chats.revealSidebar({ focus: false })
        const frame = await until(() => [...document.querySelectorAll('.abele-agent-view iframe')].find(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight && getComputedStyle(el).visibility === 'visible' && el.contentDocument?.querySelectorAll('.card').length === 3 }))
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
        const links = [...doc.querySelectorAll('a')]
        const inert = links.every(link => !link.hasAttribute('href') && link.tabIndex === -1 && link.getAttribute('aria-hidden') === 'true')
        const stage = frame.parentElement
        await until(() => stage.querySelectorAll(".abele-agent-view__hit").length === links.length, "parent targets", async () => {
          const before = stage.querySelectorAll(".abele-agent-view__hit").length
          const component = frame.__vueParentComponent
          const errors = []
          const config = component?.appContext.config
          const oldHandler = config?.errorHandler
          if (config) config.errorHandler = error => { errors.push(error?.stack || String(error)); oldHandler?.(error) }
          frame.dispatchEvent(new Event("load"))
          await wait(150)
          if (config) config.errorHandler = oldHandler
          return { before, afterLoad: stage.querySelectorAll(".abele-agent-view__hit").length, rendererErrors: rendererErrors.slice(0, 5), errors, component: component ? { mounted: component.isMounted, unmounted: component.isUnmounted, keys: Object.keys(component.setupState) } : null, tail: stage.innerHTML.slice(-800) }
        })
        const targets = [...stage.querySelectorAll('.abele-agent-view__hit')]
        const alignment = () => targets.every((target, index) => {
          const rect = target.getBoundingClientRect(), source = links[index].getBoundingClientRect(), origin = frame.getBoundingClientRect()
          if (target.classList.contains('is-offscreen')) return source.bottom <= 0 || source.top >= frame.clientHeight || source.right <= 0 || source.left >= frame.clientWidth
          return target.ownerDocument === document && target.getAttribute('role') === 'link' && !!target.getAttribute('aria-label') && Math.abs(rect.left - origin.left - Math.max(0, source.left)) < 2 && Math.abs(rect.top - origin.top - Math.max(0, source.top)) < 2
        })
        const aligned = alignment()
        const frameUrl = doc.URL
        const opened = []
        const originalOpen = window.open
        let asks = 0
        const chat = frame.closest('.abele-ai-chat')
        const countAsk = () => asks++
        chat.addEventListener('abele-view-ask', countAsk)
        const cdp = require('@electron/remote').getCurrentWebContents().debugger
        const ownedDebugger = !cdp.isAttached()
        if (ownedDebugger) cdp.attach('1.3')
        let swiped = false, hitParent = false, focusStyle
        try {
          window.open = (...args) => { opened.push(args); return null }
          const web = targets.find(link => link.dataset.abeleHref.startsWith('https:'))
          const compare = targets.find(link => link.dataset.abeleHref.startsWith('abele:ask'))
          const point = target => {
            const r = target.getBoundingClientRect()
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
          }
          const tap = async target => {
            target.scrollIntoView({ block: 'center' }); await wait(150)
            const p = point(target)
            hitParent = document.elementFromPoint(p.x, p.y) === target
            await cdp.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] })
            await cdp.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
          }
          const scroller = frame.closest('.abele-ai-chat__messages')
          scroller.scrollTop = 0; await wait(150)
          const before = scroller.scrollTop, start = point(compare)
          await cdp.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
          for (let i = 1; i <= 8; i++) {
            await cdp.sendCommand('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x, y: start.y - i * 10 }] })
            await wait(30)
          }
          await cdp.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
          await wait(250)
          swiped = scroller.scrollTop > before + 2 && asks === 0 && opened.length === 0
          await tap(web)
          await tap(compare)
          compare.click() // Compatibility click must not append the question twice.
          await until(() => chats.getSession(tab).draft.value.text === 'Compare chairs', 'touch draft', () => ({ asks, opened, swiped, hitParent, text: chats.getSession(tab).draft.value.text, target: compare.getBoundingClientRect().toJSON() }))
          await wait(100) // Let the draft's requested composer focus settle before testing Tab/Enter's target.
          compare.focus()
          for (const modifiers of [0, 8]) {
            await cdp.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers })
            await cdp.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers })
          }
          await capture('parent-focus')
          compare.focus()
          if (document.activeElement !== compare) throw Error('Parent link target did not accept keyboard focus')
          const focused = getComputedStyle(compare)
          focusStyle = { background: focused.backgroundColor, shadow: focused.boxShadow, appearance: focused.appearance, tap: focused.webkitTapHighlightColor, offset: focused.outlineOffset, transition: focused.transitionDuration, animation: focused.animationName }
          await cdp.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
          await cdp.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
          await until(() => chats.getSession(tab).draft.value.text === 'Compare chairs\\nCompare chairs')
          await wait(150)
        } catch (error) {
          await capture('routing-error')
          throw error
        } finally {
          await cdp.sendCommand('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }).catch(() => {})
          window.open = originalOpen
          chat.removeEventListener('abele-view-ask', countAsk)
          if (ownedDebugger && cdp.isAttached()) cdp.detach()
        }
        const routing = { inert, aligned, swiped, hitParent, focusStyle, asks, opened, stayed: frame.contentDocument === doc && doc.URL === frameUrl && doc.querySelectorAll('.card').length === 3 }
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
        return { cardCount, overflow, sandbox, appearance, routing, rendererErrors, unexpectedSends, executed: window.__agentViewExecuted === true, broken: broken.textContent, source: broken.parentElement.querySelector('code').textContent }
      } finally {
        console.error = originalConsoleError
        if (session && originalSend) session.sendMessage = originalSend
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
      expect(result.routing.inert).toBe(true)
      expect(result.rendererErrors).toEqual([])
      expect(result.unexpectedSends).toBe(0)
      expect(result.routing.aligned).toBe(true)
      expect(result.routing.swiped).toBe(true)
      expect(result.routing.hitParent).toBe(true)
      expect(result.routing.focusStyle).toEqual({
        background: 'rgba(0, 0, 0, 0)',
        shadow: 'none',
        appearance: 'none',
        tap: 'rgba(0, 0, 0, 0)',
        offset: '2px',
        transition: '0s',
        animation: 'none',
      })
      expect(result.routing.stayed).toBe(true)
      expect(result.routing.asks).toBe(2)
      expect(result.routing.opened).toEqual([['https://example.test/chair', '_blank', 'noopener']])
      expect(result.executed).toBe(false)
      expect(result.broken).toContain('can’t be shown')
      expect(result.source).toContain('<script>')
    },
    180_000
  )
})
