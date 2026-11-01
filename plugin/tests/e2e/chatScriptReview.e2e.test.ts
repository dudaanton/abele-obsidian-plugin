import { beforeAll, afterAll, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { vaultCli } from './helpers/obsidianCli'
import { showAs, windowSize } from './helpers/phoneWindow'
import { probePrelude, type Screen } from './helpers/layoutProbe'

const shots = fileURLToPath(new URL('../../../.scratch/chat-script-review-shots', import.meta.url))
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
    const report = vault.evalAwait<Screen>(String.raw`(async () => {
      ${probePrelude(shots)}
      const T = window.__abeleTest
      const folder = ${JSON.stringify(mobile ? 'ChatReviewPhoneProbe' : 'ChatReviewDesktopProbe')}
      if (app.vault.getAbstractFileByPath(folder)) throw new Error('Probe folder exists')
      const cfg = T.AbeleConfig.getInstance().ai
      const oldScripts = cfg.scriptsFolder
      const stored = app.loadLocalStorage('abele-agent-script-writes')
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
        const root = line.closest('.abele-chat') || line.parentElement
        const report = await screen(${JSON.stringify(mobile ? 'chat-script-review-phone' : 'chat-script-review-desktop')}, root, root)
        const r = line.getBoundingClientRect(), b = line.querySelector('button').getBoundingClientRect()
        report.extra = { text: line.textContent.trim(), visible: r.width > 0 && r.left >= 0 && r.right <= innerWidth + 1 && b.right <= innerWidth + 1 && r.bottom <= innerHeight, notice: [...document.querySelectorAll('.notice')].some(n => n.textContent.includes('Sample script with a descriptive name')) }
        return report
      } finally {
        cfg.scriptsFolder = oldScripts
        if (chat) {
          for (const leaf of app.workspace.getLeavesOfType('abele-chat')) if (leaf.view.file?.path === chat.path) leaf.detach()
        }
        const dir = app.vault.getAbstractFileByPath(folder)
        if (dir) await app.vault.delete(dir, true)
        app.saveLocalStorage('abele-agent-script-writes', stored)
      }
    })()`)
    console.info(JSON.stringify(report))
    expect(report.error).toBe('')
    expect(report.extra.visible).toBe(true)
    expect(report.extra.notice).toBe(false)
    expect(report.extra.text).toContain('Sample script with a descriptive name')
  })
}
