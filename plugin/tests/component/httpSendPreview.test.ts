import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import HttpSendPreview from '@/components/debugger/http/HttpSendPreview.vue'

describe('the card asking before an agent sends a saved request', () => {
  it('shows exactly what goes, keys by name, and says when it goes into the recording', async () => {
    const read = vi.fn(async () => ({
      environment: 'local',
      text: 'POST http://localhost:4000/samples\nAuthorization: Bearer ${abele_key:sample-key}\n\n{"qty":2}',
    }))
    const card = mount(HttpSendPreview, {
      props: { params: { id: 'Samples/Create sample.http', into_recording: true }, read },
    })
    await flushPromises()
    expect(read).toHaveBeenCalledWith('Samples/Create sample.http', undefined)
    expect(card.text()).toContain('POST http://localhost:4000/samples')
    expect(card.text()).toContain('${abele_key:sample-key}')
    expect(card.text()).toContain('Into the recording')
    expect(card.text()).toContain('local')
    expect(card.find('pre').classes()).toContain('abele-selectable')
    card.unmount()
  })

  it('says when there is no such request', async () => {
    const card = mount(HttpSendPreview, {
      props: { params: { id: 'Samples/Gone.http' }, read: async () => undefined },
    })
    await flushPromises()
    expect(card.text()).toContain('No saved request Samples/Gone.http')
    expect(card.text()).not.toContain('Into the recording')
  })
})
