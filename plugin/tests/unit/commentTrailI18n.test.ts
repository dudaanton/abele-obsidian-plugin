import { catalogs as testCatalogs } from '@/i18n/catalogs'
import { afterEach, expect, it } from 'vitest'
import { ref } from 'vue'
import { commentTrail, commentLineage } from '@/ai/commentTrail'
import type { ChatSession } from '@/ai/ChatSession'
import { initializeLocale } from '@/i18n'
import { presentUiField } from '@/i18n/streamBErrors'
import { useVault } from '../helpers/testEnv'

const source = {
  isCommentPath: (path: string) => path.startsWith('Comments/'),
  sessionFor: () => null,
}
afterEach(() => initializeLocale('en', testCatalogs['en' as keyof typeof testCatalogs]))

it('translates breadcrumb fallbacks without changing the titles used by agent context', async () => {
  useVault([])
  initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
  const anchor = { note: 'Comments/sample-parent.md', message: 'sample-message', quote: '' }
  const session = {
    kind: 'comment',
    anchor: ref(anchor),
    currentChatFile: ref({ path: 'Comments/sample-child.md' }),
    commentId: 'sample-child',
    messages: ref([]),
  } as unknown as ChatSession
  const trail = await commentTrail(source, session)
  expect(trail.map((step) => step.title)).toEqual(['Deleted', 'New question'])
  expect(trail.map((step) => presentUiField(step, 'title'))).toEqual(['Удалён', 'Новый вопрос'])
  expect(JSON.parse(JSON.stringify(trail)).map((step: { title: string }) => step.title)).toEqual([
    'Deleted',
    'New question',
  ])
  const lineage = await commentLineage(source, { note: 'Comments/sample-parent.md', quote: '' })
  expect(lineage.join('\n')).not.toMatch(/Удалён|Новый вопрос/)
})

it('preserves user-authored titles that happen to match a fallback', async () => {
  useVault([])
  initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
  const session = {
    kind: 'chat',
    chatTitle: ref('Deleted'),
    anchor: ref({ note: 'Notes/sample.md', message: 'sample-message', quote: '' }),
    currentChatFile: ref({ path: 'Comments/sample-child.md' }),
    commentId: 'sample-child',
    messages: ref([]),
  } as unknown as ChatSession
  const trail = await commentTrail(source, session)
  expect(presentUiField(trail.at(-1)!, 'title')).toBe('Deleted')
})
