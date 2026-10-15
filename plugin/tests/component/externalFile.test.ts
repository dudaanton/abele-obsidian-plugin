/**
 * A file kept on the sync server only: its tab says what it is and offers to bring it here; its
 * embed in a note opens the tab from the row and downloads from the glyph.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ExternalFileView from '@/components/external/ExternalFileView.vue'
import ExternalFileEmbed from '@/components/external/ExternalFileEmbed.vue'
import type { ExternalFile } from '@/components/external/types'

const file: ExternalFile = {
  name: 'sample-handbook.pdf',
  mime: 'application/pdf',
  size: 48 * 1024 * 1024,
  since: '3 October',
}

describe('ExternalFileView', () => {
  it('names a changed version, a failed retry and the approved narrow layout', async () => {
    const view = mount(ExternalFileView, { props: { file, state: 'changed', narrow: true } })
    expect(view.text()).toContain('A newer version is on the server')
    expect(view.get('.abele-external-view').classes()).toContain('abele-external-view_narrow')
    await view.setProps({ state: 'failed', error: 'sample network failure' })
    expect(view.text()).toContain('Did not download: sample network failure')
    await view
      .findAll('button')
      .find((button) => button.text() === 'Try again')!
      .trigger('click')
    expect(view.emitted('retry')).toHaveLength(1)
    view.unmount()
  })
  it('names the file with its kind and size and downloads on the main button', async () => {
    const view = mount(ExternalFileView, { props: { file } })
    expect(view.text()).toContain('sample-handbook.pdf')
    expect(view.text()).toContain('PDF · 48.0 MB')
    expect(view.text()).toContain('On the server since 3 October')
    await view
      .findAll('button')
      .find((b) => b.text().includes('Download'))!
      .trigger('click')
    expect(view.emitted('download')).toHaveLength(1)
  })

  it('offline, says so and offers nothing to press', () => {
    const view = mount(ExternalFileView, { props: { file, state: 'offline' } })
    expect(view.text()).toContain('Not available offline')
    for (const b of view.findAll('button')) expect(b.attributes('disabled')).toBeDefined()
  })

  it('while downloading, shows how far it is with a way to stop', async () => {
    const view = mount(ExternalFileView, {
      props: { file, state: 'downloading', progress: { done: 12 * 1024 * 1024, total: file.size } },
    })
    expect(view.text()).toContain('12.0 MB of 48.0 MB')
    await view
      .findAll('button')
      .find((b) => b.text() === 'Cancel')!
      .trigger('click')
    expect(view.emitted('cancel')).toHaveLength(1)
  })
})

describe('ExternalFileEmbed', () => {
  it('keeps an offline preview visible without intercepting scrolling or downloading on a press', async () => {
    const view = mount(ExternalFileEmbed, {
      props: { file: { ...file, preview: 'data:image/jpeg;base64,c2FtcGxl' }, state: 'offline' },
    })
    await view.get('img').trigger('click')
    await view.get('.abele-external-embed__plate').trigger('click')
    expect(view.emitted('download')).toBeUndefined()
    expect(view.emitted('open')).toBeUndefined()
    const scroll = new Event('touchmove', { cancelable: true })
    view.element.dispatchEvent(scroll)
    expect(scroll.defaultPrevented).toBe(false)
    view.unmount()
  })
  it('opens the tab from the row and downloads from the glyph alone', async () => {
    const view = mount(ExternalFileEmbed, { props: { file } })
    await view.get('.abele-external-embed__act').trigger('click')
    expect(view.emitted('download')).toHaveLength(1)
    expect(view.emitted('open')).toBeUndefined()
    await view.get('.abele-external-embed_card').trigger('click')
    expect(view.emitted('open')).toHaveLength(1)
  })
})
