import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import TokenQrReader from '@/components/sync/TokenQrReader.vue'
import { readPhoto } from '@/transfer/photo'
import { sampleIssuedToken } from '@/testing/tokenUiFixture'

vi.mock('@/transfer/photo', () => ({ readPhoto: vi.fn() }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function choosePhoto(result: string | null) {
  vi.mocked(readPhoto).mockResolvedValue(result)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sample')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 4032
      naturalHeight = 3024
      async decode() {}
    }
  )
  const view = mount(TokenQrReader)
  const input = view.find('input')
  Object.defineProperty(input.element, 'files', {
    value: [new File(['sample'], 'sample-image.jpg')],
  })
  Object.defineProperty(input.element, 'doc', {
    value: { win: { createEl: () => ({ getContext: () => ({}) }) } },
  })
  await input.trigger('change')
  await flushPromises()
  return { view, input, revoke }
}

it('validates decoded text before accepting it and emits the connection token', async () => {
  const { view, input, revoke } = await choosePhoto(sampleIssuedToken)
  const accepts = vi.mocked(readPhoto).mock.calls.at(-1)![3]
  expect(accepts('sample-unrelated-code')).toBe(false)
  expect(accepts(sampleIssuedToken)).toBe(true)
  expect(view.emitted('token')).toEqual([[sampleIssuedToken]])
  expect((input.element as HTMLInputElement).value).toBe('')
  expect(revoke).toHaveBeenCalledWith('blob:sample')
  view.unmount()
})

it('explains how to retry and keeps paste available when no token is found', async () => {
  const { view, revoke } = await choosePhoto(null)
  expect(view.get('[role="alert"]').text()).toContain(
    'Hold the camera closer so the code fills most of the picture'
  )
  expect(view.get('[role="alert"]').text()).toContain('paste the token')
  expect(view.emitted('token')).toBeUndefined()
  expect(revoke).toHaveBeenCalled()
  view.unmount()
})
