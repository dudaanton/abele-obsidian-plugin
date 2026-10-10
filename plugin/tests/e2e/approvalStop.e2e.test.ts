import { afterAll, beforeAll, expect, it } from 'vitest'
import { vaultCli } from './helpers/obsidianCli'
import { reloadAs, setWindowSize, windowSize } from './helpers/phoneWindow'
import type { TestVault } from './helpers/syncVault'
import { probePrelude } from './helpers/layoutProbe'
import { shotDir } from './helpers/shots'

const shots = shotDir('approval-stop')
let vault: TestVault
let size: [number, number]
beforeAll(() => {
  const name = process.env.OBSIDIAN_TEST_VAULT
  if (!name) throw new Error('Lease a pool vault for the approval UI check')
  vault = { ...vaultCli(name), path: '', dispose: async () => {} }
  size = windowSize(vault)
  expect(vault.evalAwait('!!window.__abeleTest')).toBe(true)
})
afterAll(async () => {
  if (!vault) return
  await setWindowSize(vault, size[0], size[1])
  await reloadAs(vault, false)
})

it.each(['desktop', 'phone'] as const)(
  '%s approval rows stay reachable and Stop settles the whole queue',
  async (device) => {
    await setWindowSize(vault, device === 'phone' ? 390 : 1200, 844)
    await reloadAs(vault, device === 'phone')
    for (const state of ['normal', 'long-command', 'several-pending']) {
      const result = vault.evalAwait<{
        buttons: string[]
        overflow: string[]
        pending: number
        rejected: number
        turns: number
        focusable: boolean
        actionRows: number
      }>(`(async () => {
      ${probePrelude(shots)}
      const chats = window.__abeleTest.ChatService.getInstance()
      const previous = chats.activeTabId.value
      if (!chats.canCreateTab) throw Error('No room for a sample chat tab')
      const tab = chats.createTab(), session = chats.getSession(tab)
      session.save = async () => {}
      session.flush = async () => {}
      let turns = 0
      session.runAgentLoop = async () => { turns++; throw Error('Stop must not start a model turn') }
      const count = ${state === 'several-pending' ? 3 : 1}
      const command = ${JSON.stringify(state === 'long-command' ? 'printf sample && inspect --directory Samples/very-long-folder-name/another-long-folder-name --pattern sample --include-subdirectories --format detailed' : 'printf sample')}
      const calls = Array.from({length: count}, (_, i) => ({type: 'toolCall', id: 'sample-call-' + i, name: 'sample_command', arguments: {command}}))
      try {
        session.pendingToolCalls.value = calls
        for (const call of calls) session.ensurePendingToolCallMessage(call)
        await chats.revealSidebar()
        if (!(await until(() => document.querySelector('.abele-tool-approval__actions'), 5000))) throw Error('Approval row did not render')
        await wait(300)
        const root = document.querySelector('.abele-tool-approval')
        root.scrollIntoView({block: 'center'})
        await wait(200)
        const buttons = [...root.querySelectorAll('.abele-tool-approval__actions button')]
        const stop = buttons.find(b => b.textContent.trim() === 'Stop')
        if (!stop) throw Error('No Stop action')
        const actionRows = new Set(buttons.map(b => Math.round(b.getBoundingClientRect().top))).size
        const overflow = [...root.querySelectorAll('*')].filter(el => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1)
        }).map(el => el.className)
        stop.focus()
        const focusable = document.activeElement === stop && !stop.disabled && stop.tabIndex >= 0
        stop.blur()
        await shoot(${JSON.stringify(device + '-' + state)})
        // The former row, alongside the new row, with the same theme, content and viewport.
        stop.style.display = 'none'
        await shoot(${JSON.stringify(device + '-' + state + '-previous-row')})
        stop.style.display = ''
        stop.click()
        await wait(100)
        await session.approveToolCall()
        return {buttons: buttons.map(b => b.textContent.trim()), overflow, focusable, actionRows,
          pending: session.pendingToolCalls.value.length,
          rejected: session.allMessages.value.filter(m => m.toolStatus === 'rejected').length, turns}
      } finally {
        session.pendingToolCalls.value = []
        chats.dropTab(tab)
        session.destroy()
        if (previous) chats.switchTab(previous)
      }
    })()`)
      expect(result.buttons).toContain('Stop')
      expect(result.overflow).toEqual([])
      expect(result.focusable).toBe(true)
      expect(result.actionRows).toBe(1)
      expect(result.pending).toBe(0)
      expect(result.rejected).toBe(state === 'several-pending' ? 3 : 1)
      expect(result.turns).toBe(0)
    }
  }
)

it.each(['desktop', 'phone'] as const)(
  '%s node approval rows fit with Stop beside Deny',
  async (device) => {
    await setWindowSize(vault, device === 'phone' ? 390 : 1200, 844)
    await reloadAs(vault, device === 'phone')
    for (const state of ['normal', 'long-command', 'several-pending']) {
      const result = vault.evalAwait<{
        rows: number
        overflow: string[]
        stopped: string
        prompt: string
      }>(`(async () => {
      ${probePrelude(shots)}
      const chats = window.__abeleTest.ChatService.getInstance(), previous = chats.activeTabId.value
      const id = 'sample-stop-node-tab'
      if (chats.nodeSessions.has(id)) throw Error('Sample node tab already exists')
      const prompts = Array.from({length: ${state === 'several-pending' ? 3 : 1}}, (_, i) => ({
        kind: 'permission', prompt_id: 'sample-prompt-' + i, run_id: 'sample-run', session_id: 'sample-session',
        state: 'pending', tool_name: 'Bash', input: {command: ${JSON.stringify(state === 'long-command' ? 'printf sample && inspect --directory Samples/very-long-folder-name/another-long-folder-name --include-subdirectories --format detailed' : 'printf sample')}}, expires_at: Date.now() + 300000,
      }))
      let stopped = ''
      const presenter = {
        id, reference: {kind: 'node-session', nodeId: 'sample-node', registrationId: 'sample-registration', sessionId: 'sample-session', title: 'Sample node run'},
        label: {value: 'Sample node run'}, provider: {value: 'claude'}, state: {value: 'needs-attention'}, isStreaming: {value: false},
        connection: {state: {value: 'connected'}, error: {value: ''}}, error: {value: ''},
        messages: {value: []}, queued: {value: []}, rejected: {value: []}, answers: {value: {}},
        draft: {value: {text: '', attachments: []}},
        projection: {value: {prompts, activeRuns: ['sample-run'], queuedInputs: [], artifacts: [], unknown: [], children: {}}},
        answer: async () => {throw Error('Stop must not answer and continue')}, send: async () => {throw Error('No model turns in this fixture')},
        stopFromApproval: async p => {stopped = p.prompt_id}, interrupt: async () => {}, openResource: () => {}, destroy: () => {},
      }
      try {
        chats.nodeSessions.set(id, presenter)
        chats.tabOrder.value = [...chats.tabOrder.value, id]
        chats.activeTabId.value = id
        await chats.revealSidebar({focus: false})
        if (!(await until(() => document.querySelector('.abele-node-permission'), 5000))) throw Error('Node request did not render')
        await wait(400)
        const root = document.querySelector('.abele-node-chat')
        const scroller = root.querySelector('.abele-ai-chat__messages')
        scroller.scrollTop = 0
        const card = root.querySelector('.abele-node-permission')
        const buttons = [...card.querySelectorAll('.abele-tool-approval__actions button')]
        const stop = buttons.find(b => b.textContent.trim() === 'Stop')
        const rows = new Set(buttons.map(b => Math.round(b.getBoundingClientRect().top))).size
        const overflow = [...root.querySelectorAll('.abele-node-permission button')].filter(b => {
          const r = b.getBoundingClientRect(); return r.width <= 0 || r.left < -1 || r.right > innerWidth + 1
        }).map(b => b.textContent)
        await shoot(${JSON.stringify(device + '-node-' + state)})
        const stops = [...root.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Stop')
        stops.forEach(b => b.style.display = 'none')
        await shoot(${JSON.stringify(device + '-node-' + state + '-previous-row')})
        stops.forEach(b => b.style.display = '')
        stop.click()
        await wait(100)
        return {rows, overflow, stopped, prompt: prompts[0].prompt_id}
      } finally {
        chats.nodeSessions.delete(id)
        chats.tabOrder.value = chats.tabOrder.value.filter(tab => tab !== id)
        if (previous) chats.switchTab(previous)
      }
    })()`)
      expect(result.rows).toBe(1)
      expect(result.overflow).toEqual([])
      expect(result.stopped).toBe(result.prompt)
    }
  }
)
