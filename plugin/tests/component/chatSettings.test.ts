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
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { fakeChatSession } from '../helpers/fakeChatSession'
import { useVault } from '../helpers/testEnv'

const deleteChat = vi.fn()

/** A session with a file behind it, which is what makes the chat something to delete. */
function seed(overrides: Record<string, unknown> = {}) {
  const session = fakeChatSession({
    overrides: {
      currentChatFile: ref({ path: 'AI/Chats/Talk.abchat' }),
      // What this dialog reads and the margin's card never does.
      interceptor: { agentId: ref(''), contextDepth: ref(0) },
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
    global: { stubs: { ObsidianModal: { template: '<div><slot /></div>' }, Dropdown: true } },
  })

const deleteButton = (view: ReturnType<typeof mountSettings>) =>
  view.findAllComponents(Button).find((one) => one.props('text') === 'Delete')

beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [] }
  deleteChat.mockReset().mockResolvedValue(true)
})

describe('throwing a chat away', () => {
  it('offers it as the destructive act it is', () => {
    seed()

    const button = deleteButton(mountSettings())

    expect(button?.props('warning')).toBe(true)
    expect(button?.props('disabled')).toBeFalsy()
  })

  it('asks first, and destroys nothing while the question is open', async () => {
    seed()
    const view = mountSettings()

    await deleteButton(view)!.vm.$emit('click')

    expect(view.findComponent(ConfirmModal).exists()).toBe(true)
    expect(deleteChat).not.toHaveBeenCalled()
  })

  it('deletes the chat this dialog is about, and closes behind itself', async () => {
    const session = seed()
    const view = mountSettings()

    await deleteButton(view)!.vm.$emit('click')
    await view.findComponent(ConfirmModal).vm.$emit('confirm')
    await nextTick()

    expect(deleteChat).toHaveBeenCalledWith(session.id)
    expect(view.emitted('close')).toHaveLength(1)
  })

  it('changes nothing when the question is dismissed', async () => {
    seed()
    const view = mountSettings()

    await deleteButton(view)!.vm.$emit('click')
    await view.findComponent(ConfirmModal).vm.$emit('close')
    await nextTick()

    expect(deleteChat).not.toHaveBeenCalled()
    expect(view.findComponent(ConfirmModal).exists()).toBe(false)
  })

  /** A tab nobody has written to yet has no file, and no file is nothing to throw away. */
  it('is dark over a conversation that has never been saved', () => {
    seed({ currentChatFile: ref(null) })

    expect(deleteButton(mountSettings())?.props('disabled')).toBe(true)
  })
})
