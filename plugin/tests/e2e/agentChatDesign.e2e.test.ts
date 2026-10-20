import { describe, expect, it } from 'vitest'
import {
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  restoreDesktopWindow,
} from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'
import { measureGlyphBoxes } from './helpers/glyphBoxes'

targets('desktop')
const shots = shotDir('abele-agent-chat-design')
const sampleReply = [
  '## Sample checklist',
  '',
  '| Task | When |',
  '| --- | --- |',
  '| Check watering | Morning |',
  '| Review shade | Afternoon |',
  '',
  '> [!note] Sample source',
  '> Keep the checklist next to the garden plan.',
  '',
  '```text',
  'water → shade → review',
  '```',
].join('\n')

// Synthetic session state drives the real sidebar. No provider is started and no tool runs.
const probe = (screen: string) => `(async () => {
  var __name = (fn) => fn
  const measureGlyphBoxes = ${measureGlyphBoxes.toString()}
  const api = window.__abeleTest
  const chats = api.ChatService.getInstance()
  const config = api.AbeleConfig.getInstance()
  const registry = api.AgentRegistry.getInstance()
  const previous = JSON.parse(JSON.stringify(config.exportSettings()))
  const oldTab = chats.activeTabId.value
  const collapsed = app.workspace.rightSplit.collapsed
  const owned = []
  const report = { states: [], shots: [], overflow: [], touch: [], glyphs: [], error: '' }
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async fn => {
    const end = Date.now() + 8000
    while (!fn()) { if (Date.now() > end) throw Error('Synthetic chat did not render'); await wait(30) }
  }
  const root = () => [...document.querySelectorAll('.abele-ai-chat')].find(el => el.getBoundingClientRect().width && el.getBoundingClientRect().height)
  const time = Date.UTC(2034, 3, 6, 12, 30)
  const q = { id: 'sample-question', role: 'user', content: 'Find the sample garden plan and suggest a short checklist.', timestamp: time }
  const call = (id, name, extra = {}) => ({ id, role: 'tool-call', parentId: 'sample-question', content: '', timestamp: time + 1000, toolName: name, toolStatus: 'approved', toolResult: 'Sample complete', ...extra })
  let session, working, waiting
  const set = messages => {
    session.isStreaming.value = false
    session.isExecutingTool.value = false
    session.streamingContent.value = ''
    session.streamingThinking.value = ''
    session.pendingToolCalls.value = []
    session.pendingQuestions.value = null
    session.error.value = null
    session.retrying.value = null
    session.queuedMessages.value = []
    session.allChatMessages = messages
    session.activeLeafId = messages.at(-1)?.id ?? null
    session.updateVisibleMessages()
  }
  const shot = async (name, selector) => {
    await until(() => root()?.querySelector(selector) || (selector === '.abele-chat-tree' && document.querySelector(selector)))
    await wait(300)
    document.activeElement?.blur?.()
    const pane = root()
    report.glyphs.push(...measureGlyphBoxes(pane))
    const box = pane.getBoundingClientRect()
    const walk = el => {
      const style = getComputedStyle(el), r = el.getBoundingClientRect()
      if (!r.width || style.visibility === 'hidden' || style.display === 'none') return
      if (r.right > box.right + 1 || r.left < box.left - 1) report.overflow.push(name + ':' + el.className)
      if (style.overflowX === 'auto' || style.overflowX === 'scroll') return
      for (const child of el.children) walk(child)
    }
    walk(pane)
    if (${JSON.stringify(screen)} === 'phone') {
      for (const button of pane.querySelectorAll('.abele-chat-question button, .abele-chat-msg__bar button, .abele-ai-chat__header-actions button, .abele-chat-input__scope')) {
        const r = button.getBoundingClientRect()
        if (r.width) report.touch.push({ name: button.getAttribute('aria-label') || button.textContent.trim(), width: r.width, height: r.height })
      }
    }
    const path = ${JSON.stringify(shots)} + '/' + ${JSON.stringify(screen)} + '-' + name + '.png'
    const image = await require('@electron/remote').getCurrentWindow().webContents.capturePage()
    require('fs').writeFileSync(path, image.toPNG())
    report.shots.push(path); report.states.push(name)
  }
  try {
    const agent = registry.create({ id: 'sample-design-agent', name: 'Sample assistant', description: 'Finds pages, reads sources and helps turn a plan into a checklist.', fullVaultAccess: true })
    config.ai.defaultAgentId = agent.id
    registry.notifyConfigReloaded()
    for (const title of ['Sample conversation', 'Sample working', 'Sample waiting']) {
      const id = chats.createTab()
      if (owned.includes(id) || id === oldTab) throw Error('No free synthetic tab')
      owned.push(id)
      const item = chats.getSession(id)
      item.save = async () => {}
      item.chatTitle.value = title
      item.agentId.value = agent.id
      item.scopeResolver.setFullVaultAccess(true)
    }
    session = chats.getSession(owned[0]); working = chats.getSession(owned[1]); waiting = chats.getSession(owned[2])
    chats.switchTab(session.id)
    await chats.revealSidebar({ focus: false })
    await until(() => !!root())

    set([])
    await shot('empty', '.abele-ai-chat__empty')

    set([q])
    session.isStreaming.value = true
    session.streamingThinking.value = 'Checking which sample sources cover watering, shade and seasonal work.'
    await shot('thinking', '.abele-chat-thinking_live')

    // A node agent streams its thought into the list: open while it is written, folded once
    // the answer follows it, and folded again when the finished turn is all that is left.
    const thought = 'Checking which sample sources cover watering, shade and seasonal work.'
    const thinkingRow = () => root()?.querySelector('[data-message-id="sample-answer"] .abele-chat-thinking')
    const expanded = () => thinkingRow()?.querySelector('.tree-item-self')?.getAttribute('aria-expanded')
    set([q, { id: 'sample-answer', role: 'assistant', parentId: q.id, timestamp: time + 2000, content: '', thinking: thought }])
    session.isStreaming.value = true
    await until(() => expanded() === 'true')
    session.allChatMessages = [q, { id: 'sample-answer', role: 'assistant', parentId: q.id, timestamp: time + 2000, content: 'The sample plan', thinking: thought }]
    session.updateVisibleMessages()
    await until(() => expanded() === 'false')
    set([q, { id: 'sample-answer', role: 'assistant', parentId: q.id, timestamp: time + 2000, content: ${JSON.stringify(sampleReply)}, thinking: thought, usage: { input: 120, output: 80, total: 200 } }])
    await until(() => expanded() === 'false')
    if (thinkingRow().querySelector('.tree-item-inner')?.textContent.trim() !== 'Thought') throw Error('A written thought is not labelled as one')
    await shot('thought', '[data-message-id="sample-answer"] .abele-chat-thinking.is-collapsed')

    set([q, call('sample-search', 'web_search'), call('sample-read', 'read', { parentId: 'sample-search', toolResult: undefined, toolParams: { path: 'Sample/garden-plan.md' } })])
    session.isExecutingTool.value = true
    session.queuedMessages.value = [{ id: 'sample-queued', content: 'Also include a short version.', timestamp: time + 3000 }]
    await shot('tool-runs', '.abele-chat-run__calls')

    set([q, call('sample-command', 'run_command', { toolStatus: 'pending', toolResult: undefined, toolCallId: 'sample-command-call', toolParams: { command: 'printf "sample check"' } })])
    session.pendingToolCalls.value = [{ id: 'sample-command-call', type: 'toolCall', name: 'run_command', arguments: { command: 'printf "sample check"' } }]
    await shot('approval', '.abele-tool-approval')

    set([q])
    session.pendingQuestions.value = { questions: [{ question: 'Which version of the sample checklist should I prepare?', options: ['A short version for a quick visit', 'A detailed version with seasonal notes and a longer explanation'] }, { question: 'Include the source links?', options: ['Yes', 'No'] }], currentIndex: 0, answers: [], resolve: () => {} }
    await until(() => root()?.querySelector('.abele-chat-question__progress'))
    const progress = root().querySelector('.abele-chat-question__progress')
    const progressRange = document.createRange()
    progressRange.selectNodeContents(progress)
    if (progressRange.getClientRects().length !== 1) throw Error('Question progress wrapped instead of staying one code')
    await shot('question', '.abele-chat-question')

    set([q])
    session.error.value = 'The sample service could not complete the response. Your question is still here; try again when the connection returns.'
    session.retrying.value = { secondsLeft: 5, attempt: 1, of: 3 }
    session.resolveModel = () => ({ name: 'Sample fallback', contextWindow: 100000 })
    await until(() => root()?.querySelector('.abele-ai-chat__error-retry'))
    const retryRange = document.createRange()
    retryRange.selectNodeContents(root().querySelector('.abele-ai-chat__error-retry'))
    if (retryRange.getClientRects().length !== 1) throw Error('Retry countdown wrapped instead of staying one code')
    await shot('error', '.abele-ai-chat__error')

    set([q, { id: 'sample-answer', role: 'assistant', parentId: q.id, timestamp: time + 2000, content: ${JSON.stringify(sampleReply)}, usage: { input: 120, output: 80, total: 200 } }])
    working.isStreaming.value = true
    waiting.pendingQuestions.value = { questions: [{ question: 'Sample choice?', options: ['Continue', 'Wait'] }], currentIndex: 0, answers: [], resolve: () => {} }
    waiting.attention.value = { question: { id: 'sample-attention', status: 'waiting', at: time, questions: waiting.pendingQuestions.value.questions, currentIndex: 0 } }
    root().querySelector('.abele-chat-switch__current').click()
    await until(() => document.querySelector('.abele-chat-tree'))
    await shot('tree', '.abele-chat-tree')
    if (${JSON.stringify(screen)} === 'desktop') {
      const dots = [...document.querySelectorAll('.abele-chat-tree__dot[role="img"]')]
      if (dots.length !== 2 || !dots.some(dot => dot.getAttribute('aria-label') === 'Waiting for you') || !dots.some(dot => dot.getAttribute('aria-label') === 'Working')) throw Error('Missing labelled tree states')
    }
    document.querySelector('.abele-chat-tree').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    working.isStreaming.value = false; waiting.pendingQuestions.value = null; waiting.attention.value = {}

    // A chat answering with a model of its own names it beside the agent, as a button for its menu.
    session.resolveModel = () => ({ id: 'sample-fast-model', name: 'Sample fast model', contextWindow: 100000 })
    session.activeModelId.value = 'sample-fast-model'
    chats.switchTab(owned[1]); chats.switchTab(session.id)
    await shot('model', '.abele-agent-selector__model')
    const chip = root().querySelector('.abele-agent-selector__model')
    if (chip.getAttribute('aria-haspopup') !== 'menu' || !chip.querySelector('svg')?.getBoundingClientRect().width) throw Error('Model chip lost its menu or its glyph')
    // Its menu offers the way back to the agent's model, and taking it drops the chip. Desktop
    // only: a phone draws the menu as a sheet over the drawer the chat is in.
    if (${JSON.stringify(screen)} === 'desktop') {
      chip.click()
      const follow = () => [...document.querySelectorAll('.menu .menu-item')].find(item => item.querySelector('.menu-item-title')?.textContent.startsWith('Follow Sample assistant'))
      await until(() => follow())
      follow().click()
      await until(() => !document.querySelector('.menu'))
    } else session.clearOverride('modelId')
    await until(() => !root()?.querySelector('.abele-agent-selector__model'))

    set([])
    session.scopeResolver.setFullVaultAccess(false)
    session.scopeResolver.addFile('Sample/reference.md')
    session.scopeResolver.addFolder('Sample/Pages')
    session.scopeResolver.addPattern('Sample/**/*.md')
    await shot('access', '.abele-chat-input__scope')
    const access = root().querySelector('.abele-chat-input__scope')
    if (!access.getAttribute('aria-label').includes('Sample/reference.md')) throw Error('Access tooltip lost the selected path')
  } catch (error) { report.error = String(error.message ?? error) }
  finally {
    if (session) set([])
    if (working) working.isStreaming.value = false
    if (waiting) { waiting.pendingQuestions.value = null; waiting.attention.value = {} }
    for (const id of owned.reverse()) await chats.deleteChat(id)
    if (oldTab) chats.switchTab(oldTab)
    config.applySettings(previous); registry.notifyConfigReloaded(); await config.saveSettings()
    if (collapsed) app.workspace.rightSplit.collapse()
  }
  return report
})()`

interface Report {
  states: string[]
  shots: string[]
  overflow: string[]
  touch: { name: string; width: number; height: number }[]
  glyphs: ReturnType<typeof measureGlyphBoxes>
  error: string
}

describe('the real agent chat design', () => {
  it.each(['desktop', 'phone'])(
    '%s keeps synthetic working and attention states usable',
    async (screen) => {
      expect(isObsidianRunning() && hasTestApi()).toBe(true)
      try {
        if (screen === 'phone') {
          await reloadApp('app.emulateMobile(true)')
          evalRaw("require('@electron/remote').getCurrentWindow().setContentSize(390, 844)")
        }
        const raw = await evalLong(probe(screen), 180_000)
        if (raw.startsWith('Error:')) throw Error(raw)
        const report = JSON.parse(raw) as Report
        console.info(JSON.stringify(report))
        expect(report.error).toBe('')
        expect(report.states).toEqual([
          'empty',
          'thinking',
          'thought',
          'tool-runs',
          'approval',
          'question',
          'error',
          'tree',
          'model',
          'access',
        ])
        expect(report.shots).toHaveLength(10)
        expect(report.overflow).toEqual([])
        expect(report.glyphs.length).toBeGreaterThan(0)
        expect(report.glyphs.filter((glyph) => glyph.squashed)).toEqual([])
        for (const target of report.touch) {
          expect(target.width, target.name).toBeGreaterThanOrEqual(44)
          expect(target.height, target.name).toBeGreaterThanOrEqual(44)
        }
      } finally {
        if (screen === 'phone') await restoreDesktopWindow()
      }
    },
    240_000
  )
})
