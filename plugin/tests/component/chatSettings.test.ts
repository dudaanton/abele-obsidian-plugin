/**
 * The chat's own settings dialog, and the one thing in it that destroys something.
 *
 * A chat could be thrown away from the history list, which is a place people go to *open* one —
 * so the way to get rid of the conversation in front of you was to go looking for it in a list
 * of every conversation you have ever had. It belongs here, behind a confirmation, because
 * nothing about it can be undone: the file, its delegated runs and its place in the index all
 * go at once.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref, shallowRef } from 'vue'
import AiChatSettings from '@/components/AiChatSettings.vue'
import Button from '@/components/obsidian/Button.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import { ChatService } from '@/ai/ChatService'
import { ChatInterceptor } from '@/ai/ChatInterceptor'
import { ScriptService } from '@/scripting/ScriptService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { fakeChatSession } from '../helpers/fakeChatSession'
import { useVault } from '../helpers/testEnv'

const deleteChat = vi.fn()

/** A real interceptor over a stand-in chat whose agent asks for `defaultId`. */
function interceptorFor(defaultId: string) {
  return new ChatInterceptor({
    conversationVersion: ref(0),
    messages: ref([]),
    findMessage: () => undefined,
    updateVisibleMessages: () => {},
    save: async () => {},
    defaultInterceptor: () => ({ agentId: defaultId, contextDepth: 0 }),
  })
}

/** A session with a file behind it, which is what makes the chat something to delete. */
function seed(overrides: Record<string, unknown> = {}) {
  const session = fakeChatSession({
    overrides: {
      currentChatFile: ref({ path: 'AI/Chats/Talk.abchat' }),
      // What this dialog reads and the margin's card never does.
      interceptor: interceptorFor(''),
      customSystemPrompt: ref(''),
      customSystemPromptNotePath: ref(''),
      activeProviderId: ref(''),
      activeModelId: ref(''),
      isOverridden: () => false,
      ...overrides,
    },
  })
  // `shallowRef`, not `ref`: a `ref` around an object makes it reactive, and a reactive object
  // unwraps the refs inside it — the dialog reads `session.currentChatFile.value` and would
  // find the file itself there, which is not the shape the real computed hands it.
  vi.spyOn(ChatService, 'getInstance').mockReturnValue({
    activeSession: shallowRef(session),
    deleteChat,
  } as never)
  return session
}

const mountSettings = () =>
  mount(AiChatSettings, {
    global: {
      stubs: {
        ObsidianModal: { template: '<div><slot /><slot name="footer" /></div>' },
        Dropdown: {
          props: ['modelValue', 'options'],
          emits: ['update:model-value'],
          template: `<select :value="modelValue" @change="$emit('update:model-value', $event.target.value)"><option v-for="o in options" :value="o.value">{{ o.display }}</option></select>`,
        },
      },
    },
  })

const deleteButton = (view: ReturnType<typeof mountSettings>) =>
  view.findAllComponents(Button).find((one) => one.props('text') === 'Delete')

beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [] }
  deleteChat.mockReset().mockResolvedValue(true)
})

describe('system prompt choices', () => {
  it('uses a labelled kit selector and saves each prompt source without changing the others', async () => {
    const session = seed({ save: vi.fn(async () => {}) })
    const view = mountSettings()
    expect(view.find('input[type="radio"]').exists()).toBe(false)
    const mode = view.findAll('select').find((one) => one.text().includes('Use global default'))!
    expect(mode.exists()).toBe(true)
    await mode.setValue('custom')
    await view.get('textarea').setValue('A fabricated prompt')
    expect(session.customSystemPrompt.value).toBe('A fabricated prompt')
    await mode.setValue('note')
    expect(session.customSystemPrompt.value).toBe('')
    expect(view.find('textarea').exists()).toBe(false)
    await view.get('input[placeholder="Path to note..."]').setValue('Samples/Prompt.md')
    expect(session.customSystemPromptNotePath.value).toBe('Samples/Prompt.md')
    await mode.setValue('default')
    expect(session.customSystemPromptNotePath.value).toBe('')
    expect(session.save).toHaveBeenCalled()
    view.unmount()
  })
})

/** Deleting is done to a chat, not a setting of it: it is in the header's ⋯ (chatArtifactsHeader). */
describe('throwing a chat away', () => {
  it('is not among the settings', () => {
    seed()

    expect(deleteButton(mountSettings())).toBeUndefined()
  })
})

/**
 * The chat's reviewer: its agent's unless this chat picked another, or Off. The first option
 * names the agent's reviewer so following it is not a choice made blind.
 */
describe('the interceptor picker', () => {
  const picker = (view: ReturnType<typeof mountSettings>) =>
    view.findAll('select').find((one) => one.text().includes('Agent default'))!

  function withReviewer() {
    const registry = AgentRegistry.getInstance()
    const reviewer = registry.create({ name: 'Reviewer', utility: true })
    const other = registry.create({ name: 'Other', utility: true })
    const interceptor = interceptorFor(reviewer.id)
    const session = seed({ interceptor, save: vi.fn(async () => {}) })
    return { reviewer, other, interceptor, session }
  }

  it("names the agent's reviewer as the default, and starts on it", () => {
    withReviewer()
    const select = picker(mountSettings())

    expect(select.findAll('option')[0].text()).toBe('Agent default (Reviewer)')
    expect((select.element as HTMLSelectElement).selectedIndex).toBe(0)
  })

  it('says off when the agent has no reviewer', () => {
    seed({ interceptor: interceptorFor(''), save: vi.fn(async () => {}) })
    AgentRegistry.getInstance().create({ name: 'Reviewer' })

    expect(picker(mountSettings()).findAll('option')[0].text()).toBe('Agent default (off)')
  })

  it('turns review off for this chat only', async () => {
    const { interceptor } = withReviewer()

    await picker(mountSettings()).setValue('')

    expect(interceptor.isActive).toBe(false)
    expect(interceptor.followsAgent).toBe(false)
  })

  it('picks another reviewer, and goes back to the agent', async () => {
    const { interceptor, other, reviewer } = withReviewer()
    const view = mountSettings()

    await picker(view).setValue(other.id)
    expect(interceptor.agentId.value).toBe(other.id)

    await picker(view).setValue(':agent')
    expect(interceptor.followsAgent).toBe(true)
    expect(interceptor.agentId.value).toBe(reviewer.id)
  })

  it('offers interceptor scripts, and narrows this chat to messages matching a pattern', async () => {
    const { interceptor } = withReviewer()
    ScriptService.getInstance().scriptList.value = [
      {
        path: 'Scripts/guard.js',
        meta: { name: 'Guard', description: '', params: [], interceptor: 30 },
        code: '',
        commandId: 'abele:script-guard',
      },
    ]
    const view = mountSettings()

    await picker(view).setValue('script:Guard')
    expect(interceptor.script.value).toBe('Guard')
    expect(picker(view).text()).not.toContain('missing')
    expect(interceptor.agentId.value).toBe('')

    const field = view.find('input[placeholder="Every message"]')
    await field.setValue('^/todo')
    expect(interceptor.pattern.value).toBe('^/todo')
    await field.setValue('([a-')
    expect(interceptor.pattern.value).toBe('^/todo')
    expect(view.find('.mod-warning').text()).toMatch(/Not saved/)
    ScriptService.getInstance().scriptList.value = []
  })

  it('names a chosen script that is no longer there as missing', () => {
    const { interceptor } = withReviewer()
    interceptor.script.value = 'Gone'
    expect(picker(mountSettings()).text()).toContain('Script: Gone · missing')
  })
})
