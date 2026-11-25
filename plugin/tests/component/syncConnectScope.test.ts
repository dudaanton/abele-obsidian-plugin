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

it('reports a malformed token even when scope inspection cannot start', async () => {
  const ui = tokenUiFixture(true)
  const connectScope = vi.spyOn(ui.itemSets, 'connectScope')
  ui.itemSets.install()
  const wrapper = mount(TokenDialogs, {
    props: { ui, mode: 'connect' },
    global: { stubs: { Modal: { template: '<div><slot /><slot name="footer" /></div>' } } },
  })
  try {
    await wrapper.find('input[type=password]').setValue('damaged token')
    await flushPromises()
    const connect = wrapper
      .findAllComponents(Button)
      .find((one) => one.props('text') === 'Connect')!
    expect(connect.props('disabled')).toBe(false)
    expect(wrapper.get('[role=alert]').text()).toMatch(/token.*damaged|damaged.*token/i)
    expect(connectScope).not.toHaveBeenCalled()
  } finally {
    wrapper.unmount()
    ui.itemSets.uninstall()
  }
})

it.each([1, 3])(
  'connects the full %i-item access directly so issuer changes remain live',
  async (count) => {
    const ui = tokenUiFixture(true)
    const narrowed = [
      { kind: 'folder' as const, id: 'folder-a', path: 'Garden' },
      { kind: 'group' as const, id: 'group-a', path: 'Reading.md' },
      { kind: 'file' as const, id: 'file-a', path: 'Plan.md' },
    ].slice(0, count)
    vi.spyOn(ui.itemSets, 'connectScope').mockResolvedValue({
      choices: narrowed,
      narrowed,
      serverFiles: 3,
    })
    const connect = vi.spyOn(ui, 'connect').mockResolvedValue()
    ui.itemSets.install()
    const wrapper = mount(TokenDialogs, {
      props: { ui, mode: 'connect' },
      global: { stubs: { Modal: { template: '<div><slot /><slot name="footer" /></div>' } } },
    })
    try {
      await wrapper.find('input[type=password]').setValue(token())
      await flushPromises()
      expect(wrapper.findComponent(DeviceScopeField).props('modelValue')).toEqual(narrowed)
      await wrapper
        .findAllComponents(Button)
        .find((button) => button.props('text') === 'Connect')!
        .trigger('click')
      expect(connect).toHaveBeenCalledWith(token(), expect.any(AbortSignal))
    } finally {
      wrapper.unmount()
      ui.itemSets.uninstall()
    }
  }
)

it('allows Close while metadata is still pending and aborts that check on dismissal', async () => {
  const ui = tokenUiFixture(true)
  const answer = deferred<ConnectScope>()
  let signal: AbortSignal | undefined
  vi.spyOn(ui.itemSets, 'connectScope').mockImplementation((_text, current) => {
    signal = current
    return answer.promise
  })
  const connect = vi.spyOn(ui, 'connect')
  ui.itemSets.install()
  const wrapper = mount(TokenDialogs, {
    props: { ui, mode: 'connect' },
    global: { stubs: { Modal: { template: '<div><slot /><slot name="footer" /></div>' } } },
  })
  try {
    await wrapper.find('input[type=password]').setValue(token())
    const close = wrapper
      .findAllComponents(Button)
      .find((button) => button.props('text') === 'Close')!
    expect(close.props('disabled')).toBeFalsy()
    await close.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
    expect(signal?.aborted).toBe(true)
    expect(connect).not.toHaveBeenCalled()
    answer.resolve({ choices: [], serverFiles: 0 })
    await flushPromises()
  } finally {
    if (wrapper.exists()) wrapper.unmount()
    ui.itemSets.uninstall()
  }
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

it('ignores an old token answer and exposes the current check failure for retry', async () => {
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
    expect(action.props('disabled')).toBe(false)
    expect(wrapper.get('[role=alert]').text()).toMatch(/could not finish|server/i)
    expect(connect).not.toHaveBeenCalled()
    await action.trigger('click')
    expect(wrapper.get('[role=alert]').text()).toMatch(/could not finish|server/i)
    expect(connect).not.toHaveBeenCalled()
  } finally {
    wrapper.unmount()
    ui.itemSets.uninstall()
  }
})
