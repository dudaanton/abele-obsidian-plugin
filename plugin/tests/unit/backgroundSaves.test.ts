/**
 * Settings writes nobody waits on.
 *
 * A chat's history entry and a settings screen's edits are written in the background. Such a
 * write can fail — or land after the plugin unloaded, when there is no plugin to write through
 * — and with no caller to hand the error to it has to be logged where it happens, never left
 * as an unhandled rejection.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ChatStorage } from '@/ai/ChatStorage'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useSettingsSave } from '@/composables/useSettingsSave'
import { useVault } from '../helpers/testEnv'

let logged: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  useVault([])
  ChatStorage.destroy()
  const config = AbeleConfig.getInstance()
  config.ai = { ...DEFAULT_AI_SETTINGS, chatHistory: [] }
  vi.spyOn(config, 'saveSettings').mockRejectedValue(new Error('no plugin'))
  logged = vi.spyOn(console, 'error').mockImplementation(() => {
    // Asserted below.
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('a background settings write that fails', () => {
  it('is logged by the chat history, not left unhandled', async () => {
    ChatStorage.getInstance().addHistoryEntry({
      path: 'Chats/One.md',
      title: 'One',
      created: '2026-09-25',
    })
    await settle()

    expect(logged).toHaveBeenCalledWith(
      '[Abele] Failed to save the chat history',
      expect.any(Error)
    )
  })

  it('is logged by a settings screen closing with an edit still waiting', async () => {
    const Screen = defineComponent({
      setup() {
        const { save } = useSettingsSave(
          () => {},
          () => {}
        )
        save()
        return () => null
      },
    })
    mount(Screen).unmount()
    await settle()

    expect(logged).toHaveBeenCalledWith('[Abele] Failed to save settings', expect.any(Error))
  })
})
