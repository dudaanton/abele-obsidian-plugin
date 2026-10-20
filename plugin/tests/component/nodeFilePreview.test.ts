import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import FileView from '@/components/nodeWork/FileView.vue'
import HistoryView from '@/components/nodeWork/HistoryView.vue'

vi.mock('@/github/codeViewer', () => ({ mountCode: vi.fn(() => ({ destroy: vi.fn() })) }))
afterEach(() => vi.restoreAllMocks())
const image = { bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), mime: 'image/png' }
const binary = {
  path: 'sample.bin',
  kind: 'modified' as const,
  binary: true,
  before: '',
  after: '',
  added: 0,
  removed: 0,
}
describe('node binary and image presentation', () => {
  it('passes selected lines to the file context menu instead of quoting the whole file', async () => {
    const view = mount(FileView, {
      props: {
        path: 'sample.ts',
        text: 'kept\nchanged\n',
        mode: 'diff',
        change: {
          path: 'sample.ts',
          kind: 'modified',
          before: 'kept\nbefore\n',
          after: 'kept\nchanged\n',
          added: 1,
          removed: 1,
        },
      },
    })
    await flushPromises()
    const line = view.findAll('.abele-diff__text').find((row) => row.text().includes('changed'))!
    const range = document.createRange()
    range.selectNodeContents(line.element)
    const selection = document.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await line.trigger('contextmenu')
    expect(view.emitted('menu')?.[0]?.[1]).toBe('changed')
    expect(view.emitted('menu')?.[0]?.[2]).toMatchObject({ from: 2, to: 2, text: 'changed' })
    selection.removeAllRanges()
    await view.trigger('contextmenu')
    expect(view.emitted('menu')?.[1]?.[1]).toBe('')
    view.unmount()
  })
  it('redraws only the commit file whose contents arrived, not every file of the commit', async () => {
    const file = (path: string, pending: boolean) => ({
      ...binary,
      path,
      binary: undefined,
      pending,
      after: pending ? '' : 'sample text\n',
    })
    const page = (files: ReturnType<typeof file>[]) => [
      {
        hash: 'sample-hash',
        subject: 'Update notes',
        author: 'Sample',
        day: 'Today',
        when: '12:00',
        files,
      },
    ]
    const waiting = file('second.txt', true)
    const view = mount(HistoryView, {
      props: { open: 'sample-hash', commits: page([file('first.txt', true), waiting]) },
    })
    const before = view.findAllComponents(FileView)[1]!.props('change')
    await view.setProps({ commits: page([file('first.txt', false), waiting]) })
    expect(view.findAllComponents(FileView)[1]!.props('change')).toBe(before)
    expect(view.findAllComponents(FileView)[0]!.props('change')).toMatchObject({
      path: 'first.txt',
      pending: false,
    })
    view.unmount()
  })
  it('shows a commit file still being read by its name and a loading line, not an empty diff', () => {
    const view = mount(HistoryView, {
      props: {
        open: 'sample-hash',
        commits: [
          {
            hash: 'sample-hash',
            subject: 'Update notes',
            author: 'Sample',
            day: 'Today',
            when: '12:00',
            files: [{ ...binary, path: 'sample.txt', binary: undefined, pending: true }],
          },
        ],
      },
    })
    expect(view.text()).toContain('sample.txt')
    expect(view.text()).toContain('Loading changes…')
    expect(view.find('.abele-diff').exists()).toBe(false)
    expect(view.find('.abele-file-view__code').exists()).toBe(false)
    view.unmount()
  })
  it('renders a binary commit entry as metadata instead of a blank text diff', () => {
    const view = mount(HistoryView, {
      props: {
        open: 'sample-hash',
        commits: [
          {
            hash: 'sample-hash',
            subject: 'Update assets',
            author: 'Sample',
            day: 'Today',
            when: '12:00',
            files: [binary],
          },
        ],
      },
    })
    expect(view.text()).toContain('sample.bin')
    expect(view.text()).toContain('Binary file · no text diff.')
    expect(view.find('.abele-diff').exists()).toBe(false)
    expect(view.find('.abele-file-view__code').exists()).toBe(false)
    view.unmount()
  })
  it('uses the shared Image with a blob URL and revokes every URL on replacement and close', async () => {
    const create = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:sample-image-1')
      .mockReturnValueOnce('blob:sample-image-2')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const view = mount(FileView, { props: { path: 'sample-image.png', text: '', image } })
    await flushPromises()
    expect(create).toHaveBeenCalledTimes(1)
    expect(view.find('img.abele-image').attributes('src')).toBe('blob:sample-image-1')
    expect(view.find('img').attributes('alt')).toBe('sample-image.png')
    expect(view.find('.abele-file-view__code').exists()).toBe(false)
    await view.setProps({ image: { ...image, bytes: new Uint8Array(image.bytes) } })
    expect(revoke).toHaveBeenCalledWith('blob:sample-image-1')
    await view.setProps({ image: undefined, path: 'sample.txt', text: 'Text file' })
    expect(revoke).toHaveBeenCalledWith('blob:sample-image-2')
    expect(view.find('img').exists()).toBe(false)
    view.unmount()
    expect(revoke).toHaveBeenCalledTimes(2)
  })
  it('revokes the image URL when the pane is closed directly', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sample-image')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const view = mount(FileView, { props: { path: 'sample-image.png', text: '', image } })
    view.unmount()
    expect(revoke).toHaveBeenCalledWith('blob:sample-image')
  })
})
