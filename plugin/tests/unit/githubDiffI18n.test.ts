import { catalogs as testCatalogs } from '@/i18n/catalogs'
import { afterEach, expect, it, vi } from 'vitest'
import { computeDiff } from '@/github/comparison/compute'
import * as text from '@/github/comparison/text'
import { initializeLocale } from '@/i18n'
import { presentUiError } from '@/i18n/streamBErrors'

const workers = vi.hoisted(
  () =>
    [] as {
      onmessage: (event: { data: { error: string; code?: string } }) => void
      terminate: ReturnType<typeof vi.fn>
    }[]
)
vi.mock('@/github/comparison/diff.worker?worker&inline', () => ({
  default: class {
    onmessage!: (event: { data: { error: string; code?: string } }) => void
    terminate = vi.fn()
    postMessage() {}
    constructor() {
      workers.push(this)
    }
  },
}))
afterEach(() => {
  workers.length = 0
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  initializeLocale('en', testCatalogs['en' as keyof typeof testCatalogs])
})

it.each([
  [
    'line-budget',
    'This diff exceeds the line budget. Open each side separately.',
    'В сравнении слишком много строк. Откройте каждую сторону отдельно.',
  ],
  [
    'distinct-lines',
    'Too many distinct lines to compare safely. Open each side separately.',
    'Слишком много различных строк для сравнения. Откройте каждую сторону отдельно.',
  ],
])('localizes a diff failure across the worker boundary: %s', async (code, original, localized) => {
  initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
  const pending = computeDiff('x'.repeat(100000), '')
  workers[0].onmessage({ data: { error: original, code } })
  const error = await pending.catch((error: unknown) => error)
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toBe(original)
  expect(presentUiError(error)).toBe(localized)
  expect(workers[0].terminate).toHaveBeenCalledOnce()
})

it('localizes the same failure in a small main-thread comparison', () => {
  initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
  vi.spyOn(text, 'fullDiff').mockImplementationOnce(() => {
    throw new text.DiffComputationError('line-budget')
  })
  try {
    computeDiff('sample', '')
    expect.fail('Expected the comparison to fail')
  } catch (error) {
    expect(presentUiError(error)).toBe(
      'В сравнении слишком много строк. Откройте каждую сторону отдельно.'
    )
  }
})

it('leaves unknown worker failures verbatim', async () => {
  initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
  const pending = computeDiff('x'.repeat(100000), '')
  workers[0].onmessage({ data: { error: 'Sample failure {unchanged}' } })
  expect(presentUiError(await pending.catch((error: unknown) => error))).toBe(
    'Sample failure {unchanged}'
  )
})

it('carries the comparison failure code out of the real worker handler', async () => {
  const scope = { postMessage: vi.fn(), onmessage: (_event: MessageEvent) => {} }
  vi.stubGlobal('self', scope)
  await import('@/github/comparison/diff.worker')
  scope.onmessage(new MessageEvent('message', { data: { before: '\n'.repeat(100001), after: '' } }))
  expect(scope.postMessage).toHaveBeenCalledWith({
    error: 'This diff exceeds the line budget. Open each side separately.',
    code: 'line-budget',
  })
})
