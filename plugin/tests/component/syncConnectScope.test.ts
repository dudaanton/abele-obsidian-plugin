import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { Platform } from 'obsidian'
import DeviceScopeField from '@/components/sync/DeviceScopeField.vue'
import TokenDialogs from '@/components/sync/TokenDialogs.vue'
import Button from '@/components/obsidian/Button.vue'
import Modal from '@/components/obsidian/Modal.vue'
import { tokenUiFixture } from '@/testing/tokenUiFixture'
import { shareSetSource, type ConnectScope } from '@/sync/shareSets'
import { encodeAccessToken } from '@/sync/v2/contract'
import { deferred } from '../helpers/deferred'

afterEach(() => {
  Platform.isPhone = false
  shareSetSource.value = null
})
const token = (key = 'a') =>
  encodeAccessToken({
    v: 1,
    address: 'https://sync.example',
    key: key.repeat(43),
    scope: { kind: 'folder', id: 'root', path: '/' },
  })

it('checks metadata without connecting and passes the chosen scope only after Connect', async () => {
  Platform.isPhone = true
  const ui = tokenUiFixture(true)
  const answer = deferred<ConnectScope>()
  vi.spyOn(ui.itemSets, 'connectScope').mockReturnValue(answer.promise)
  const connect = vi.spyOn(ui, 'connect').mockResolvedValue()
  const start = vi.spyOn(ui, 'connectionsChanged')
  ui.itemSets.install()
  const wrapper = mount(TokenDialogs, {
    props: { ui, mode: 'connect' },
    global: {
      stubs: {
        Modal: { props: ['size'], template: '<div><slot /><slot name="footer" /></div>' },
      },
    },
  })
  const vault = { kind: 'vault' as const, id: 'vault', path: '/' }
  const folder = { kind: 'folder' as const, id: 'folder-a', path: 'Garden' }
  try {
    await wrapper.find('input[type="password"]').setValue(token())
    expect(connect).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    const action = () =>
      wrapper.findAllComponents(Button).find((button) => button.props('text') === 'Connect')!
    expect(action().props('disabled')).toBe(true)
    answer.resolve({ choices: [vault, folder], serverFiles: 0 })
    await flushPromises()
    expect(wrapper.findComponent(Modal).props('size')).toBe('tall')
    expect(wrapper.findComponent(DeviceScopeField).props('modelValue')).toEqual([vault])
    wrapper.findComponent(DeviceScopeField).vm.$emit('update:modelValue', [folder])
    await flushPromises()
    await action().trigger('click')
    expect(connect.mock.calls[0][0]).toBe(token())
    expect(connect.mock.calls[0][2]).toEqual([folder])
  } finally {
    wrapper.unmount()
    ui.itemSets.uninstall()
  }
})

it('ignores an old token answer and keeps Connect disabled after the current check fails', async () => {
  Platform.isPhone = true
  const ui = tokenUiFixture(true)
  const first = deferred<ConnectScope>(),
    second = deferred<ConnectScope>()
  vi.spyOn(ui.itemSets, 'connectScope')
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
  const connect = vi.spyOn(ui, 'connect').mockResolvedValue()
  ui.itemSets.install()
  const wrapper = mount(TokenDialogs, {
    props: { ui, mode: 'connect' },
    global: {
      stubs: {
        Modal: { props: ['size'], template: '<div><slot /><slot name="footer" /></div>' },
      },
    },
  })
  try {
    const input = wrapper.find('input[type="password"]')
    await input.setValue(token('a'))
    await input.setValue(token('b'))
    first.resolve({ choices: [{ kind: 'vault', id: 'vault', path: '/' }], serverFiles: 4 })
    await flushPromises()
    expect(wrapper.findComponent(DeviceScopeField).exists()).toBe(false)
    second.reject(new Error('offline'))
    await flushPromises()
    const action = wrapper
      .findAllComponents(Button)
      .find((button) => button.props('text') === 'Connect')!
    expect(action.props('disabled')).toBe(true)
    expect(connect).not.toHaveBeenCalled()
  } finally {
    wrapper.unmount()
    ui.itemSets.uninstall()
  }
})
