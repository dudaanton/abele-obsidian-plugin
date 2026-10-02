import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import TransferScanModal from '@/components/settings/transfer/TransferScanModal.vue'
import Button from '@/components/obsidian/Button.vue'
import { deferred } from '../helpers/deferred'
import { useVault } from '../helpers/testEnv'
import { AbeleConfig } from '@/services/AbeleConfig'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it.each(['permission', 'playback'] as const)(
  'does not leave a camera or scan timer after closing during %s',
  async (stage) => {
    useVault([])
    AbeleConfig.getInstance().applySettings(undefined)
    const permission = deferred<MediaStream>()
    const playing = deferred<void>()
    const track = { stop: vi.fn() }
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => permission.promise } })
    vi.spyOn(HTMLMediaElement.prototype, 'srcObject', 'set').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => playing.promise)
    const interval = vi.spyOn(window, 'setInterval').mockReturnValue(1234)
    const screen = mount(TransferScanModal, {
      global: { stubs: { ObsidianModal: { template: '<div><slot /></div>' } } },
    })
    const start = screen
      .findAllComponents(Button)
      .find((button) => button.props('text') === 'Use the camera')!
    await start.vm.$emit('click')
    if (stage === 'playback') {
      permission.resolve({ getTracks: () => [track] } as unknown as MediaStream)
      await flushPromises()
    }
    screen.unmount()
    permission.resolve({ getTracks: () => [track] } as unknown as MediaStream)
    playing.resolve()
    await flushPromises()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(interval).not.toHaveBeenCalled()
  }
)
