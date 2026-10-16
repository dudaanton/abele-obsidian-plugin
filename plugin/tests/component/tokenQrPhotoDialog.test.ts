import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createCanvas, ImageData, loadImage } from '@napi-rs/canvas'
import TokenDialogs from '@/components/sync/TokenDialogs.vue'
import { tokenUiFixture } from '@/testing/tokenUiFixture'
import { photo, token } from './qrPhotoFixture'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('fills the Connect field from an uploaded degraded JPEG through decoding and validation', async () => {
  const width = 4032,
    height = 3024
  const pixels = photo(
    { name: 'sample-photo', tilt: 0.18, screen: 15, glare: 35, contrast: 0.75 },
    { x: 0, y: 0, width, height },
    { width, height }
  )
  const source = createCanvas(width, height)
  source.getContext('2d').putImageData(new ImageData(pixels.data, width, height), 0, 0)
  const jpeg = source.encodeSync('jpeg', 65)
  const file = new File([new Uint8Array(jpeg)], 'sample-screen-photo.jpg', { type: 'image/jpeg' })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sample-photo')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Offline'))

  // Supply browser image/canvas APIs with native JPEG decoding and canvas resampling.
  // The photo reader, QR decoder, validator and dialog binding are all real.
  class BrowserImage {
    src = ''
    naturalWidth = 0
    naturalHeight = 0
    image?: Awaited<ReturnType<typeof loadImage>>
    async decode() {
      expect(this.src).toBe('blob:sample-photo')
      this.image = await loadImage(new Uint8Array(await file.arrayBuffer()))
      this.naturalWidth = this.image.width
      this.naturalHeight = this.image.height
    }
  }
  vi.stubGlobal('Image', BrowserImage)
  const canvas = createCanvas(1, 1)
  const context = canvas.getContext('2d')
  const drawImage = vi.fn((image: BrowserImage, ...rect: number[]) => {
    context.drawImage(
      image.image!,
      ...(rect as [number, number, number, number, number, number, number, number])
    )
  })
  const view = mount(TokenDialogs, {
    props: { ui: tokenUiFixture(true), mode: 'connect' },
    global: { stubs: { Modal: { template: '<div><slot /><slot name="footer" /></div>' } } },
  })
  try {
    const picker = view.get('input[type=file]')
    Object.defineProperty(picker.element, 'files', { value: [file] })
    Object.defineProperty(picker.element, 'doc', {
      value: {
        win: {
          createEl: () => ({
            set width(value: number) {
              canvas.width = value
            },
            set height(value: number) {
              canvas.height = value
            },
            getContext: () => ({ drawImage, getImageData: context.getImageData.bind(context) }),
          }),
        },
      },
    })
    await picker.trigger('change')
    await vi.waitFor(
      async () => {
        await flushPromises()
        expect((view.get('input:not([type=file])').element as HTMLInputElement).value).toBe(token)
      },
      { timeout: 5000 }
    )
    expect(drawImage).toHaveBeenCalled()
    expect(view.find('[role="alert"]').exists()).toBe(false)
    expect(revoke).toHaveBeenCalledWith('blob:sample-photo')
  } finally {
    view.unmount()
  }
}, 15000)
