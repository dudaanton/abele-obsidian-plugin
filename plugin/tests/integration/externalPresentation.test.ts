import { expect, it, vi } from 'vitest'
import { sha256 } from '@abele/sync-sdk/core'
import { ExternalState } from '@/sync/external/state'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive, h, defineComponent } from 'vue'
import { externalFileFixture } from './externalFileFollowupFixture'
import { ExternalPresentation } from '@/sync/external/presentation'
import ExternalFileView from '@/components/external/ExternalFileView.vue'
import ExternalFileEmbed from '@/components/external/ExternalFileEmbed.vue'

it('keeps the newer-version notice after verified stub metadata advances', async () => {
  const s = await externalFileFixture('Media/sample.pdf')
  try {
    await s.port.evict(s.path)
    const projection = JSON.parse(await s.app.vault.adapter.read(s.path + '.abele-ref'))
    projection.observedVersionId = 'sample-new-version'
    const bytes = new TextEncoder().encode(JSON.stringify(projection) + '\n')
    await s.app.vault.adapter.writeBinary(s.path + '.abele-ref', bytes.buffer)
    const document = JSON.parse((await s.state.getExternalState())!)
    const external = await ExternalState.open(s.state, document.ledgerId, s.binding)
    await external.commit({
      expectedRevision: document.revision,
      files: [
        {
          expectedRevision: document.files[0].localRevision,
          next: {
            ...document.files[0],
            localRevision: document.files[0].localRevision + 1,
            projectionSha: await sha256(bytes),
          },
        },
      ],
    })
    await s.state.put({ ...s.head, versionId: 'sample-new-version' })
    const p = new ExternalPresentation(s.manager, s.path, () => true)
    try {
      await p.refresh()
      expect(p.value.state).toBe('changed')
    } finally {
      p.dispose()
    }
  } finally {
    s.close()
  }
})

it('renders actual streamed byte progress while the staging write is still pending', async () => {
  const s = await externalFileFixture('Media/sample.pdf')
  try {
    await s.port.evict(s.path)
    let reached!: () => void, release!: () => void
    const writing = new Promise<void>((resolve) => {
      reached = resolve
    })
    const paused = new Promise<void>((resolve) => {
      release = resolve
    })
    const write = s.app.vault.adapter.writeBinary.bind(s.app.vault.adapter)
    vi.spyOn(s.app.vault.adapter, 'writeBinary').mockImplementation(
      async (path, bytes, options) => {
        if (path.endsWith('.incoming') && bytes.byteLength === s.bytes.length) {
          reached()
          await paused
        }
        await write(path, bytes, options)
      }
    )
    const p = new ExternalPresentation(s.manager, s.path, () => true)
    await p.refresh()
    const props = reactive(p.value)
    const off = p.subscribe(() => Object.assign(props, p.value))
    const view = mount(defineComponent(() => () => h(ExternalFileView, props)))
    const running = p.download()
    await writing
    await vi.waitFor(() => expect(p.value.progress?.done).toBe(s.bytes.length))
    await flushPromises()
    expect(p.value.state).toBe('downloading')
    expect(view.text()).toContain('21 B of 21 B')
    release()
    await running
    off()
    view.unmount()
    p.dispose()
  } finally {
    s.close()
  }
})

it('retains metadata and says offline after its connection closes', async () => {
  const s = await externalFileFixture('Media/sample.pdf')
  try {
    await s.port.evict(s.path)
    s.port.close()
    const p = new ExternalPresentation(s.manager, s.path, () => true)
    await p.refresh()
    expect(p.value.file.mime).toBe('application/pdf')
    expect(p.value.file.size).toBe(s.bytes.length)
    expect(p.value.state).toBe('offline')
    p.dispose()
  } finally {
    s.close()
  }
})

it('cancels a partial download without losing the stub and allows a fresh retry', async () => {
  const s = await externalFileFixture()
  try {
    await s.port.evict(s.path)
    let reached!: () => void, release!: () => void
    const reading = new Promise<void>((resolve) => {
      reached = resolve
    })
    const paused = new Promise<void>((resolve) => {
      release = resolve
    })
    const open = s.manager.openVersion.bind(s.manager)
    const source = vi.spyOn(s.manager, 'openVersion').mockImplementationOnce(async () => ({
      size: s.bytes.length,
      read: async () => {
        reached()
        await paused
        return s.bytes
      },
      assertUnchanged: async () => {},
      close: async () => {},
    }))
    const p = new ExternalPresentation(s.manager, s.path, () => true)
    const running = p.download()
    await reading
    p.cancel()
    release()
    await running
    expect(await s.app.vault.adapter.exists(s.path + '.abele-ref')).toBe(true)
    expect(await s.app.vault.adapter.exists(s.path)).toBe(false)
    source.mockImplementation(open)
    await p.download()
    expect(p.value.hydrated).toBe(true)
    p.dispose()
  } finally {
    s.close()
  }
})

it('wires owned stub metadata, changed, offline, failure and retry to the approved card', async () => {
  let fail = false
  const s = await externalFileFixture(
    'Media/sample.pdf',
    async () => {},
    async () => {},
    async () => {
      if (fail) throw new Error('sample transfer failed')
      return s.bytes
    }
  )
  try {
    await s.port.evict(s.path)
    const presentation = new ExternalPresentation(s.manager, s.path, () => true)
    await presentation.refresh()
    const props = reactive(presentation.value)
    const off = presentation.subscribe(() => Object.assign(props, presentation.value))
    const view = mount(
      defineComponent(
        () => () =>
          h(ExternalFileView, {
            ...props,
            onDownload: () => presentation.download(),
            onRetry: () => presentation.download(),
          })
      )
    )
    expect(view.text()).toContain('sample.pdf')
    expect(view.text()).toContain('PDF')
    expect(presentation.value.state).toBe('remote')
    await s.state.put({ ...s.head, versionId: 'sample-new-version' })
    await presentation.refresh()
    expect(view.text()).toContain('A newer version is on the server')
    await s.state.put(s.head)
    presentation.online = () => false
    await presentation.refresh()
    expect(view.text()).toContain('Not available offline')
    presentation.online = () => true
    fail = true
    await presentation.download()
    expect(view.text()).toContain('Did not download')
    fail = false
    await presentation.download()
    expect(presentation.value.hydrated).toBe(true)
    expect(await s.app.vault.adapter.read(s.path)).toBe('sample original bytes')
    off()
    view.unmount()
    presentation.dispose()
  } finally {
    s.close()
  }
})

it('reports actual bytes read from a bounded transfer source', async () => {
  const s = await externalFileFixture()
  try {
    await s.port.evict(s.path)
    const values: number[] = []
    const off = s.manager.subscribe(() => {
      const progress = s.manager.transfer(s.path)
      if (progress) values.push(progress.done)
    })
    await s.manager.prepare([s.path])
    expect(values).toContain(0)
    expect(values).toContain(s.bytes.length)
    off()
  } finally {
    s.close()
  }
})

it('only the embed glyph downloads; pressing a saved preview leaves note bytes unchanged', async () => {
  const s = await externalFileFixture()
  try {
    await s.app.vault.create('sample-note.md', '![[Media/sample.png]]')
    await s.port.evict(s.path)
    const p = new ExternalPresentation(s.manager, s.path, () => true)
    await p.refresh()
    const download = vi.fn(() => p.download())
    const file = { ...p.value.file, preview: 'data:image/jpeg;base64,c2FtcGxl' }
    const embed = mount(ExternalFileEmbed, { props: { file, onDownload: download } })
    await embed.get('img').trigger('click')
    expect(download).not.toHaveBeenCalled()
    await embed.get('.abele-external-embed__plate').trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(p.value.hydrated).toBe(true))
    expect(await s.app.vault.adapter.read('sample-note.md')).toBe('![[Media/sample.png]]')
    embed.unmount()
    p.dispose()
  } finally {
    s.close()
  }
})
