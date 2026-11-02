import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { createCreateFileTool } from '@/ai/tools/CreateFileTool'
import ChatScriptReview from '@/components/ChatScriptReview.vue'
import { ScriptService } from '@/scripting/ScriptService'
import { ScriptTrust } from '@/scripting/ScriptTrust'
import { reviewOne } from '@/scripting/scriptReview'
import { WaitingScriptsNotice } from '@/scripting/scriptReview'
import { noteAgentScriptWrite } from '@/scripting/trust/agentScriptWrites'
import { sha256 } from '@abele/sync-sdk/core'
import { useVault, configureAbele } from '../helpers/testEnv'
import type { ParsedScript } from '@/scripting/types'

vi.mock('@/scripting/reviewScript', () => ({ reviewScript: vi.fn(async () => false) }))

const text = '// @name Sample\nreturn 1'
let app: ReturnType<typeof useVault>
const waiting = ref<ParsedScript[]>([])
const service = {
  waitingScripts: () => waiting.value,
  review: vi.fn(async (_script: ParsedScript) => true),
}
let view: ReturnType<typeof mount> | undefined
beforeEach(async () => {
  app = useVault([])
  configureAbele()
  service.review.mockClear()
  vi.spyOn(ScriptService, 'getInstance').mockReturnValue(service as never)
  waiting.value = [
    {
      path: 'Scripts/sample.js',
      hash: await sha256(new TextEncoder().encode(text)),
      meta: { name: 'Sample' },
    } as ParsedScript,
  ]
  document.querySelectorAll('.notice').forEach((el) => el.remove())
})
afterEach(() => {
  view?.unmount()
  view = undefined
  vi.restoreAllMocks()
})

it('pins an agent-written version to its own chat, without a notice even before mounting', async () => {
  await noteAgentScriptWrite(app as never, 'Scripts/sample.js', text, 'sample-chat')
  const notice = new WaitingScriptsNotice({ ...service, reviewWaiting: vi.fn() })
  notice.announce()
  expect(document.querySelector('.notice')).toBeNull()
  view = mount(ChatScriptReview, { props: { chatId: 'other-chat' } })
  expect(view.text()).toBe('')
  await view.setProps({ chatId: 'sample-chat' })
  expect(view.text()).toContain('Script changed: Sample')
  await view.get('button').trigger('click')
  expect(service.review).toHaveBeenCalledWith(waiting.value[0])
  waiting.value = []
  await nextTick()
  expect(view.text()).toBe('')
})

it('keeps the full name in a tooltip and groups the separator with the review action', async () => {
  waiting.value[0].meta.name = 'Sample script with a descriptive name'
  await noteAgentScriptWrite(app as never, 'Scripts/sample.js', text, 'sample-chat')
  view = mount(ChatScriptReview, { props: { chatId: 'sample-chat' } })
  expect(view.attributes('title')).toBe('Sample script with a descriptive name')
  expect(view.get('.abele-chat-script-review__action').get('[aria-hidden="true"]').text()).toBe('·')
  expect(view.get('.abele-chat-script-review__action button').text()).toBe('Review')
  expect(view.get('button').attributes('type')).toBe('button')
})

it('keeps other sources in the existing notice, not in a chat footer', () => {
  new WaitingScriptsNotice({ ...service, reviewWaiting: vi.fn() }).announce()
  expect(document.querySelector('.notice')?.textContent).toContain('Sample')
  view = mount(ChatScriptReview, { props: { chatId: 'sample-chat' } })
  expect(view.text()).toBe('')
})

it('reviews all and only the exact versions owned by this chat and survives reopening', async () => {
  const first = waiting.value[0]
  const second = { ...first, path: 'Scripts/second.js', meta: { name: 'Second' } } as ParsedScript
  const other = { ...first, path: 'Scripts/other.js' } as ParsedScript
  waiting.value = [first, second, other]
  await noteAgentScriptWrite(app as never, first.path, text, 'sample-chat')
  await noteAgentScriptWrite(app as never, second.path, text, 'sample-chat')
  await noteAgentScriptWrite(app as never, other.path, text, 'other-chat')
  view = mount(ChatScriptReview, { props: { chatId: 'sample-chat' } })
  expect(view.text()).toContain('Scripts changed: 2')
  view.unmount()
  view = mount(ChatScriptReview, { props: { chatId: 'sample-chat' } })
  await view.get('button').trigger('click')
  await nextTick()
  expect(service.review.mock.calls.map((call) => call[0])).toEqual([first, second])
})

it('returns an externally changed version at the same path to the notice', async () => {
  await noteAgentScriptWrite(app as never, waiting.value[0].path, text, 'sample-chat')
  waiting.value = [{ ...waiting.value[0], hash: 'new-external-version' }]
  view = mount(ChatScriptReview, { props: { chatId: 'sample-chat' } })
  expect(view.text()).toBe('')
  new WaitingScriptsNotice({ ...service, reviewWaiting: vi.fn() }).announce()
  expect(document.querySelector('.notice')?.textContent).toContain('Sample')
})

it('hides a deferred exact version across reopening without granting approval', async () => {
  const item = waiting.value[0]
  await noteAgentScriptWrite(app as never, item.path, text, 'sample-chat')
  vi.spyOn(ScriptTrust, 'getInstance').mockReturnValue({ lastConfirmed: () => undefined } as never)
  const confirm = vi.fn()
  view = mount(ChatScriptReview, { props: { chatId: 'sample-chat' } })
  expect(view.text()).toContain('Sample')
  expect(await reviewOne({ verdict: () => 'waiting', confirm } as never, item)).toBe(false)
  await nextTick()
  expect(view.text()).toBe('')
  expect(confirm).not.toHaveBeenCalled()
  view.unmount()
  view = mount(ChatScriptReview, { props: { chatId: 'sample-chat' } })
  expect(view.text()).toBe('')
})

it('receives persisted ownership from the chat file tool context', async () => {
  await createCreateFileTool({ skipScope: true }).execute(
    'sample-create',
    {
      path: 'Scripts/sample.js',
      content: text,
    },
    undefined,
    { app, session: { scriptReviewChatId: 'sample-chat' } } as never
  )
  new WaitingScriptsNotice({ ...service, reviewWaiting: vi.fn() }).announce()
  expect(document.querySelector('.notice')).toBeNull()
  view = mount(ChatScriptReview, { props: { chatId: 'sample-chat' } })
  expect(view.text()).toContain('Script changed: Sample')
})
