import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import SaveMediaModal from '@/components/SaveMediaModal.vue'
import Button from '@/components/obsidian/Button.vue'
import { request } from '@/helpers/http'
import { useVault } from '../helpers/testEnv'

vi.mock('@/helpers/http', () => ({ request: vi.fn() }))
afterEach(() => vi.restoreAllMocks())

it('saves distinct bytes when an equal-sized existing image has the same FNV hash', async () => {
  const app = useVault([
    { path: 'sample-note.md', content: '![Sample](https://sample.invalid/image.png)' },
  ])
  const original = new Uint8Array([143, 82, 11, 131, 12, 88, 103, 239]).buffer
  const downloaded = new Uint8Array([215, 216, 198, 248, 126, 230, 250, 146]).buffer
  const existing = await app.vault.createBinary('Attachments/sample-existing.png', original)
  existing.stat.size = original.byteLength
  vi.mocked(request).mockResolvedValue({
    status: 200,
    headers: { 'content-type': 'image/png' },
    arrayBuffer: downloaded,
  } as never)
  const screen = mount(SaveMediaModal, {
    global: { stubs: { AiScopeEditor: true, ObsidianModal: { template: '<div><slot /></div>' } } },
  })
  try {
    const button = (text: string) =>
      screen.findAllComponents(Button).find((item) => item.props('text') === text)!
    await button('Scan').trigger('click')
    await flushPromises()
    await button('Download').trigger('click')
    await flushPromises()
    const images = app.vault.getFiles().filter((file) => file.extension === 'png')
    expect(images).toHaveLength(2)
    const saved = images.find((file) => file.path !== existing.path)!
    expect(new Uint8Array(await app.vault.readBinary(saved))).toEqual(new Uint8Array(downloaded))
    expect(new Uint8Array(await app.vault.readBinary(existing))).toEqual(new Uint8Array(original))
  } finally {
    screen.unmount()
  }
})

it('still reuses an equal-sized attachment with identical content', async () => {
  const app = useVault([
    { path: 'sample-note.md', content: '![Sample](https://sample.invalid/image.png)' },
  ])
  const bytes = new Uint8Array([1, 2, 3]).buffer
  const existing = await app.vault.createBinary('Attachments/sample-existing.png', bytes)
  existing.stat.size = bytes.byteLength
  vi.mocked(request).mockResolvedValue({
    status: 200,
    headers: { 'content-type': 'image/png' },
    arrayBuffer: bytes,
  } as never)
  const screen = mount(SaveMediaModal, {
    global: { stubs: { AiScopeEditor: true, ObsidianModal: { template: '<div><slot /></div>' } } },
  })
  try {
    const button = (text: string) =>
      screen.findAllComponents(Button).find((item) => item.props('text') === text)!
    await button('Scan').vm.$emit('click')
    await flushPromises()
    await button('Download').vm.$emit('click')
    await flushPromises()
    expect(app.vault.getFiles().filter((file) => file.extension === 'png')).toHaveLength(1)
    expect(await app.vault.read(app.vault.getFileByPath('sample-note.md')!)).toContain(
      'sample-existing.png'
    )
  } finally {
    screen.unmount()
  }
})

it('reads attachment contents only for files the size of the downloaded media', async () => {
  const app = useVault([
    { path: 'sample-note.md', content: '![Sample](https://sample.invalid/image.png)' },
  ])
  for (let size = 20; size < 25; size++) {
    const file = await app.vault.createBinary(
      `Attachments/sample-${size}.png`,
      new Uint8Array(size).buffer
    )
    file.stat.size = size
  }
  const bytes = new Uint8Array([1, 2, 3]).buffer
  vi.mocked(request).mockResolvedValue({
    status: 200,
    headers: { 'content-type': 'image/png' },
    arrayBuffer: bytes,
  } as never)
  const read = vi.spyOn(app.vault, 'readBinary')
  const screen = mount(SaveMediaModal, {
    global: { stubs: { AiScopeEditor: true, ObsidianModal: { template: '<div><slot /></div>' } } },
  })
  try {
    const button = (text: string) =>
      screen.findAllComponents(Button).find((item) => item.props('text') === text)!
    await button('Scan').vm.$emit('click')
    await flushPromises()
    await button('Download').vm.$emit('click')
    await flushPromises()
    expect(screen.text()).toContain('saved')
    expect(read).not.toHaveBeenCalled()
  } finally {
    screen.unmount()
  }
})
