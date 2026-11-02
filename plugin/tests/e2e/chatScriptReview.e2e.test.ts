import { beforeAll, afterAll, expect, it } from 'vitest'
import { shotDir } from './helpers/shots'
import { vaultCli } from './helpers/obsidianCli'
import { showAs, windowSize } from './helpers/phoneWindow'
import { probePrelude, type Screen } from './helpers/layoutProbe'

const shots = shotDir('abele-chat-script-review')
let vault: ReturnType<typeof vaultCli>
let size: [number, number]
beforeAll(() => {
  const name = process.env.OBSIDIAN_TEST_VAULT
  if (!name) throw new Error('Needs an exclusively leased pool vault')
  vault = vaultCli(name)
  size = windowSize(vault)
})
afterAll(async () => {
  if (vault) await showAs(vault, size[0], size[1], false)
})

for (const mobile of [false, true]) {
  it(`pins script review in the real ${mobile ? 'phone' : 'desktop'} chat`, async () => {
    await showAs(vault, mobile ? 390 : 1280, mobile ? 844 : 900, mobile)
    const report = vault.evalAwait<{
      single: Screen
      two: Screen
      deferred: Screen
    }>(String.raw`(async () => {
      ${probePrelude(shots)}
      const T = window.__abeleTest
      const folder = ${JSON.stringify(mobile ? 'ChatReviewPhoneProbe' : 'ChatReviewDesktopProbe')}
      if (app.vault.getAbstractFileByPath(folder)) throw new Error('Probe folder exists')
      const cfg = T.AbeleConfig.getInstance().ai
      const oldScripts = cfg.scriptsFolder
      const stored = app.loadLocalStorage('abele-agent-script-writes')
      const dismissed = app.loadLocalStorage('abele-script-notice-dismissed')
      const service = T.ChatService.getInstance()
      let chat = null
      try {
        await app.vault.createFolder(folder)
        cfg.scriptsFolder = folder
        const meta = { v: 2, k: 'meta', type: 'abele-chat', created: '2026-11-01', title: 'Sample script review' }
        chat = await app.vault.create(folder + '/sample.abchat', JSON.stringify(meta) + '\n')
        await service.openChatFile(chat)
        // A phone reload starts with its chat drawer closed; selecting a session alone
        // does not mount the sidebar. Exercise the visible chat, not only its service.
        await service.revealSidebar()
        const session = service.getSessionByFile(chat.path)
        if (!session) throw new Error('Chat did not open')
        const tool = T.createAgentTools({ session }).find(t => t.name === 'create')
        await tool.execute('sample-create', { path: folder + '/sample.js', content: '// @name Sample script with a descriptive name\nreturn 1' }, undefined, { session, scope: session.scopeResolver, app })
        if (!(await until(() => document.querySelector('.abele-chat-script-review'), 12000))) throw new Error('Review line missing: ' + JSON.stringify({ chat: session.scriptReviewChatId, active: service.activeSession.value?.scriptReviewChatId, waiting: T.ScriptService.getInstance().waitingScripts().map(s => [s.path, s.hash]), stored: app.loadLocalStorage('abele-agent-script-writes'), roots: document.querySelectorAll('.abele-chat').length }))
        const line = document.querySelector('.abele-chat-script-review')
        const root = line.closest('.abele-ai-chat')
        function layout() {
          const text = line.querySelector('.abele-chat-script-review__text')
          const action = line.querySelector('.abele-chat-script-review__action')
          const button = line.querySelector('button')
          const tr = text.getBoundingClientRect(), ar = action.getBoundingClientRect()
          const box = root.querySelector('.abele-chat-input__box').getBoundingClientRect()
          const style = getComputedStyle(button)
          const accent = document.createElement('span')
          accent.style.color = 'var(--text-accent)'
          line.append(accent)
          const accentColor = getComputedStyle(accent).color
          accent.remove()
          return { aligned: Math.abs(tr.left - box.left) <= 1, adjacent: ar.left - tr.right >= 0 && ar.left - tr.right <= 6, oneLine: getComputedStyle(line).whiteSpace === 'nowrap' && Math.abs(tr.top - ar.top) <= 2, ellipsis: getComputedStyle(text).textOverflow === 'ellipsis' && getComputedStyle(text).overflow === 'hidden', accent: style.color === accentColor, pointer: style.cursor === 'pointer', actionVisible: ar.right <= box.right + 1, tooltip: line.title }
        }
        const report = await screen(${JSON.stringify(mobile ? 'chat-script-review-phone' : 'chat-script-review-desktop')}, root, root)
        const r = line.getBoundingClientRect(), b = line.querySelector('button').getBoundingClientRect()
        report.extra = { ...layout(), text: line.textContent.trim(), visible: r.width > 0 && r.left >= 0 && r.right <= innerWidth + 1 && b.right <= innerWidth + 1 && r.bottom <= innerHeight, notice: [...document.querySelectorAll('.notice')].some(n => n.textContent.includes('Sample script with a descriptive name')) }
        await tool.execute('second-create', { path: folder + '/second.js', content: '// @name Second sample script\nreturn 2' }, undefined, { session, scope: session.scopeResolver, app })
        const scripts = T.ScriptService.getInstance()
        if (!(await until(() => scripts.waitingScripts().filter(s => s.path.startsWith(folder + '/')).length === 2 && document.querySelector('.abele-chat-script-review')?.textContent.includes('2'), 12000))) throw new Error('Two-script review line missing')
        const two = await screen(${JSON.stringify(mobile ? 'chat-script-review-phone-two' : 'chat-script-review-desktop-two')}, root, root)
        two.extra = { ...layout(), text: document.querySelector('.abele-chat-script-review').textContent.trim() }
        document.querySelector('.abele-chat-script-review button').click()
        for (let i = 0; i < 2; i++) {
          if (!(await until(() => document.querySelector('.abele-script-review .abele-modal__footer button:not(.mod-cta)'), 5000))) throw new Error('Review dialog missing for script ' + i)
          document.querySelector('.abele-script-review .abele-modal__footer button:not(.mod-cta)').click()
          if (!(await until(() => (app.loadLocalStorage('abele-script-notice-dismissed') || []).filter(k => k.startsWith(folder + '/')).length === i + 1, 5000))) throw new Error('Defer was not persisted')
        }
        if (!(await until(() => !document.querySelector('.abele-chat-script-review') && !document.querySelector('.abele-script-review'), 5000))) throw new Error('Deferred scripts still shown')
        const deferred = await screen(${JSON.stringify(mobile ? 'chat-script-review-phone-deferred' : 'chat-script-review-desktop-deferred')}, root, root)
        deferred.extra = { waiting: scripts.waitingScripts().filter(s => s.path.startsWith(folder + '/')).length, line: !!document.querySelector('.abele-chat-script-review'), notice: [...document.querySelectorAll('.notice')].some(n => n.textContent.includes('sample script') || n.textContent.includes('Sample script')) }
        return { single: report, two, deferred }
      } finally {
        cfg.scriptsFolder = oldScripts
        if (chat) {
          for (const leaf of app.workspace.getLeavesOfType('abele-chat')) if (leaf.view.file?.path === chat.path) leaf.detach()
        }
        const dir = app.vault.getAbstractFileByPath(folder)
        if (dir) await app.vault.delete(dir, true)
        app.saveLocalStorage('abele-agent-script-writes', stored)
        app.saveLocalStorage('abele-script-notice-dismissed', dismissed)
      }
    })()`)
    console.info(JSON.stringify(report))
    for (const screen of [report.single, report.two, report.deferred]) {
      expect(screen.error).toBe('')
      expect(screen.shot).toMatch(/\.png$/)
    }
    for (const state of [report.single, report.two]) {
      for (const key of [
        'aligned',
        'adjacent',
        'oneLine',
        'ellipsis',
        'accent',
        'pointer',
        'actionVisible',
      ])
        expect(state.extra[key], key).toBe(true)
      expect(state.extra.tooltip).toContain('Sample script with a descriptive name')
    }
    expect(report.single.extra.visible).toBe(true)
    expect(report.single.extra.notice).toBe(false)
    expect(report.single.extra.text).toContain('Sample script with a descriptive name')
    expect(report.two.extra.text).toContain('2')
    expect(report.deferred.extra).toEqual({ waiting: 2, line: false, notice: false })
  })
}
