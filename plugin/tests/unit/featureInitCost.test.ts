import { afterEach, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'

vi.mock('@/vendor/foliate-js/epub.js', () => ({
  EPUB: class {
    sections = [{ id: 'sample-a.xml' }, { id: 'sample-b.xml' }]
    transformTarget = new EventTarget()
    resources = { getItemByHref: () => ({ mediaType: 'application/xml' }) }
    async init() {
      return this
    }
    async loadDocument() {
      return document
    }
  },
}))

const calls = vi.hoisted(() => ({ use: 0, ms: 0, parse: 0 }))
vi.mock('echarts/core', async (original) => {
  const real = await original<typeof import('echarts/core')>()
  return {
    ...real,
    use: (...args: Parameters<typeof real.use>) => {
      calls.use++
      const start = performance.now()
      real.use(...args)
      calls.ms += performance.now() - start
    },
    init: vi.fn(() => ({})),
  }
})
vi.mock('@/reader/bookSafety', async (original) => {
  const real = await original<typeof import('@/reader/bookSafety')>()
  return {
    ...real,
    sanitizePage: (...args: Parameters<typeof real.sanitizePage>) => {
      calls.parse++
      return real.sanitizePage(...args)
    },
  }
})
afterEach(() => vi.restoreAllMocks())

it('registers chart extensions only on first chart use, once', async () => {
  const charts = await import('@/bases/echarts')
  console.info(`chart import: registrations=${calls.use}, registrationMs=${calls.ms.toFixed(3)}`)
  expect(calls.use).toBe(0)
  charts.echartsInit(document.createElement('div'))
  charts.echartsInit(document.createElement('div'))
  expect(calls.use).toBe(1)
  console.info(`chart first use: registrationMs=${calls.ms.toFixed(3)}`)
})

it('does not parse a fallback chapter just to register the reader', async () => {
  await import('@/reader/openBook')
  console.info(`reader import: fallbackParses=${calls.parse}`)
  expect(calls.parse).toBe(0)
})

it('creates the safe fallback once on demand and frees its book URLs', async () => {
  const { openEpub } = await import('@/reader/openBook')
  const made = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sample-chapter')
  const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const opened = await openEpub(zipSync({ 'META-INF/container.xml': strToU8('<container/>') }))
  expect(calls.parse).toBe(0)
  const section = opened.book.sections[0]
  expect(await section.load()).toBe('blob:sample-chapter')
  expect(await opened.book.sections[1].load()).toBe('blob:sample-chapter')
  expect(calls.parse).toBe(1)
  expect(made).toHaveBeenCalledTimes(1)
  const page = await section.createDocument!()
  expect(page.documentElement.textContent).toContain('format the reader does not show')
  opened.destroy()
  expect(revoked).toHaveBeenCalledWith('blob:sample-chapter')
})
