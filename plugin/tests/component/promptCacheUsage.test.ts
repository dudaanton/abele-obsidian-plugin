import { mount } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import AiChatMessageDetails from '@/components/AiChatMessageDetails.vue'
import { initializeLocale } from '@/i18n'
import { catalogs } from '@/i18n/catalogs'

afterEach(() => initializeLocale('en', catalogs.en))
it('shows cache reads and writes beside the existing token counts in every locale', () => {
  for (const locale of ['en', 'ru', 'lv', 'es', 'de'] as const) {
    initializeLocale(locale, catalogs[locale])
    const view = mount(AiChatMessageDetails, {
      props: {
        message: {
          id: 'sample',
          role: 'assistant',
          content: '',
          timestamp: 0,
          usage: { input: 11, output: 22, total: 110, cacheRead: 33, cacheWrite: 44 },
        },
        captureSelection: () => {},
        askHere: () => {},
      },
    })
    const text = view.find('.abele-chat-msg__detail-row').text()
    for (const n of [11, 22, 110, 33, 44]) expect(text).toContain(String(n))
    expect(text).not.toContain('streamBMeta.')
    view.unmount()
  }
})
