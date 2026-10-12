import { describe, expect, it } from 'vitest'
import { readNodeImage } from '@/node/nodeImagePreview'

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))
const blob = { content_id: 'sample-content', size: 16, too_large: false }
const part = (bytes: number[]) => async (offset: number) => ({
  offset,
  total: bytes.length,
  base64: btoa(String.fromCharCode(...bytes)),
})
describe('raster image identification', () => {
  it.each([
    ['sample.PNG', [137, 80, 78, 71, 13, 10, 26, 10], 'image/png'],
    ['sample.jpg', [255, 216, 255, 224], 'image/jpeg'],
    ['sample.jpeg', [255, 216, 255, 224], 'image/jpeg'],
    ['sample.gif', ascii('GIF89a'), 'image/gif'],
    ['sample.webp', ascii('RIFF1234WEBP'), 'image/webp'],
    ['sample.bmp', ascii('BM12'), 'image/bmp'],
    ['sample.ico', [0, 0, 1, 0, 1, 0], 'image/x-icon'],
  ])('identifies %s from bounded bytes', async (path, bytes, mime) => {
    expect((await readNodeImage(path, blob, part(bytes))).mime).toBe(mime)
  })
  it('does not trust an image extension on arbitrary bytes', async () => {
    await expect(readNodeImage('sample.png', blob, part([0, 1, 2, 3]))).rejects.toThrow(
      'Binary file'
    )
  })
  it('does not embed vector documents as raster images', async () => {
    await expect(readNodeImage('sample.svg', blob, part(ascii('<svg/>')))).rejects.toThrow(
      'Binary file'
    )
  })
  it('assembles split binary chunks before identifying the image', async () => {
    const bytes = [137, 80, 78, 71, 13, 10, 26, 10]
    const read = async (offset: number) => ({
      offset,
      total: bytes.length,
      base64: btoa(String.fromCharCode(...bytes.slice(offset, offset + 3))),
    })
    expect((await readNodeImage('sample.png', blob, read)).bytes).toEqual(new Uint8Array(bytes))
  })
})
