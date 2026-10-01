import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { thumbnailOf, forgetThumbnails } from '@/properties/thumbnails'
import { loadPdfJs } from 'obsidian'
import { templateHarness } from '../helpers/templateHarness'

const { getCover, init, isZip, openZip } = vi.hoisted(() => ({
  getCover: vi.fn(),
  init: vi.fn(),
  isZip: vi.fn(),
  openZip: vi.fn(),
}))
vi.mock('@/vendor/foliate-js/epub.js', () => ({
  EPUB: class {
    async init() {
      await init()
      return this
    }
    getCover() {
      return getCover()
    }
  },
}))
vi.mock('@/reader/zipLoader', () => ({ isZip, openZip }))
vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<typeof import('obsidian')>()),
  loadPdfJs: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  forgetThumbnails()
  vi.mocked(loadPdfJs).mockResolvedValue(null)
  isZip.mockReturnValue(true)
  openZip.mockReturnValue({ loadText: vi.fn(), loadBlob: vi.fn(), getSize: vi.fn() })
  init.mockResolvedValue(undefined)
  getCover.mockResolvedValue(new Blob(['sample'], { type: 'image/png' }))
  vi.spyOn(console, 'debug').mockImplementation(() => {})
})
afterEach(() => {
  forgetThumbnails()
  vi.restoreAllMocks()
})

function setup() {
  const env = templateHarness([
    { path: 'Media/sample.png' },
    { path: 'Books/sample.epub' },
    { path: 'Files/sample.pdf' },
    { path: 'Files/sample.zip' },
    { path: 'Notes/sample.md', frontmatter: { cover: '[[Media/sample.png]]' } },
  ])
  const readBinary = vi.spyOn(env.app.vault, 'readBinary').mockResolvedValue(new ArrayBuffer(4))
  return { ...env, readBinary, file: (path: string) => env.app.vault.getFileByPath(path)! }
}

describe('file-card thumbnails', () => {
  it('uses live resource URLs for images and note covers, and reads no binary for other kinds', async () => {
    const env = setup()
    const image = env.file('Media/sample.png')
    expect(await thumbnailOf(env.app, image)).toBe('app://sample/Media/sample.png?0-0')
    image.stat.mtime = 20
    expect(await thumbnailOf(env.app, image)).toBe('app://sample/Media/sample.png?20-0')
    const note = env.file('Notes/sample.md')
    expect(await thumbnailOf(env.app, note)).toBe('app://sample/Media/sample.png?20-0')
    env.app.setFrontmatter(note.path, {})
    expect(await thumbnailOf(env.app, note)).toBeNull()
    expect(await thumbnailOf(env.app, env.file('Files/sample.zip'))).toBeNull()
    expect(env.readBinary).not.toHaveBeenCalled()
  })

  it('shares pending EPUB work by path/mtime/size, invalidates versions and revokes owned URLs on unload', async () => {
    const env = setup()
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sample-cover')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const file = env.file('Books/sample.epub')
    const pending = thumbnailOf(env.app, file)
    expect(thumbnailOf(env.app, file)).toBe(pending)
    expect(await pending).toBe('blob:sample-cover')
    expect(env.readBinary).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
    file.stat.mtime++
    await thumbnailOf(env.app, file)
    expect(env.readBinary).toHaveBeenCalledTimes(2)
    forgetThumbnails()
    expect(revoke).toHaveBeenCalledWith('blob:sample-cover')
    await thumbnailOf(env.app, file)
    expect(env.readBinary).toHaveBeenCalledTimes(3)
  })

  it('rejects huge files before IO and caches failures, absent covers and nonimages', async () => {
    const env = setup()
    const file = env.file('Books/sample.epub')
    file.stat.size = 150 * 1024 * 1024 + 1
    expect(await thumbnailOf(env.app, file)).toBeNull()
    expect(env.readBinary).not.toHaveBeenCalled()
    file.stat.size = 150 * 1024 * 1024
    env.readBinary.mockRejectedValueOnce(new Error('sample read failure'))
    expect(await thumbnailOf(env.app, file)).toBeNull()
    expect(await thumbnailOf(env.app, file)).toBeNull()
    expect(env.readBinary).toHaveBeenCalledTimes(1)
    for (const cover of [null, new Blob(['sample'], { type: 'text/html' })]) {
      file.stat.mtime++
      getCover.mockResolvedValue(cover)
      expect(await thumbnailOf(env.app, file)).toBeNull()
    }
    file.stat.mtime++
    isZip.mockReturnValue(false)
    expect(await thumbnailOf(env.app, file)).toBeNull()
    expect(openZip).toHaveBeenCalledTimes(2)
  })

  it('returns no PDF picture without a library and renders the first page at card width with scripting disabled', async () => {
    const env = setup()
    const file = env.file('Files/sample.pdf')
    expect(await thumbnailOf(env.app, file)).toBeNull()
    expect(env.readBinary).not.toHaveBeenCalled()
    file.stat.mtime++
    const render = vi.fn(() => ({ promise: Promise.resolve() }))
    const getViewport = vi.fn(({ scale }: { scale: number }) => ({
      width: 640 * scale,
      height: 800 * scale,
    }))
    const destroy = vi.fn(async () => {})
    const getPage = vi.fn(async () => ({ getViewport, render }))
    const getDocument = vi.fn(() => ({ promise: Promise.resolve({ getPage, destroy }) }))
    vi.mocked(loadPdfJs).mockResolvedValue({ getDocument } as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;sample')
    expect(await thumbnailOf(env.app, file)).toBe('data:image/jpeg;sample')
    expect(getDocument).toHaveBeenCalledWith({
      data: expect.any(Uint8Array),
      isEvalSupported: false,
      enableXfa: false,
      enableScripting: false,
      disableAutoFetch: true,
    })
    expect(getPage).toHaveBeenCalledWith(1)
    expect(getViewport.mock.calls).toEqual([[{ scale: 1 }], [{ scale: 0.25 }]])
    expect(destroy).toHaveBeenCalledTimes(1)
    file.stat.mtime++
    getPage.mockRejectedValueOnce(new Error('sample page failure'))
    expect(await thumbnailOf(env.app, file)).toBeNull()
    expect(destroy).toHaveBeenCalledTimes(2)
  })
})
