import { catalogs as testCatalogs } from '@/i18n/catalogs'
import { ref, watch } from 'vue'
import { t } from '../../src/i18n'
import { itemHead, placeLink } from '../../src/github/itemHead'
import type { GithubTarget } from '../../src/github/urls'
import type { ListData } from '../../src/github/lists/listData'
import { compileQuery } from '../../src/github/search/textSearch'
import { projectBranchCuts } from '../../src/ai/chatBranchCuts'
import { streamBTime } from '../../src/i18n/streamBDate'
import { formatTimestamp as originalTimestamp } from '../../src/helpers/displayFormat'
import { explainRefusal } from '../../src/github/refusal'
import { endpoints } from '../../src/github/urls'
import { UiError, uiMessage, uiFields, uiField, presentUiField } from '../../src/i18n/streamBErrors'
import { afterEach, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { extract, checkMigrated } from '../../scripts/i18n-manifest.mjs'
import { createHash } from 'node:crypto'
import { catalogs, validateCatalogs } from '../../src/i18n/catalogs'
import { chat } from '../../src/i18n/locales/en/chat'
import ledger from '../../src/i18n/chat-ledger.json'
import { repository } from '../../src/i18n/locales/en/repository'
import repositoryLedger from '../../src/i18n/repository-ledger.json'
import CompactModal from '../../src/components/nodeSession/CompactModal.vue'
import { initializeLocale } from '../../src/i18n'
import GithubComment from '../../src/components/github/GithubComment.vue'
import { streamB } from '../../src/i18n/locales/en/streamB'
import streamBLedger from '../../src/i18n/streamB-ledger.json'
import { streamBErrors } from '../../src/i18n/locales/en/streamBErrors'
import errorLedger from '../../src/i18n/streamBErrors-ledger.json'
import { streamBCounts } from '../../src/i18n/locales/en/streamBCounts'
import countLedger from '../../src/i18n/streamBCounts-ledger.json'
import { streamBMeta } from '../../src/i18n/locales/en/streamBMeta'
import metaLedger from '../../src/i18n/streamBMeta-ledger.json'
import { presentUiError } from '../../src/i18n/streamBErrors'
import { GithubError, GithubClient } from '../../src/github/client'
import { createAgent } from '../../src/ai/agents/types'
import { plural } from '../../src/components/nodeWork/codes'
import ChatFindBar from '../../src/components/ChatFindBar.vue'
import ChatThinking from '../../src/components/ChatThinking.vue'
import ChatReplyCard from '../../src/components/chat/ChatReplyCard.vue'
import BackgroundTasks from '../../src/components/nodeSession/BackgroundTasks.vue'
import SessionMarkLine from '../../src/components/nodeSession/SessionMarkLine.vue'
import { reduceTranscript } from '../../src/node/NodeTranscriptReducer'
const surfaces = [
  'AiChat.vue',
  'AiDiscussionAnchor.vue',
  'AiToolApproval.vue',
  'AiRewindDialog.vue',
  'NodeChatView.vue',
  'NodePairingDialog.vue',
  'NodeFilesDialog.vue',
  'nodeWork/FileTree.vue',
  'nodeWork/NodePanel.vue',
  'github/GithubItem.vue',
  'github/GithubList.vue',
  'ChatFindBar.vue',
  'ChatThinking.vue',
  'ChatMessageBar.vue',
  'ChatSelectionBar.vue',
  'ChatBranchSwitch.vue',
  'ChatAnchorHistory.vue',
  'chat/ChatBranchTitle.vue',
  'chat/ChatReplyCard.vue',
  'ChatQuestionCard.vue',
  'ChatToolModes.vue',
  'chatTree/ChatSwitcher.vue',
  'chatTree/ChatTreePanel.vue',
  'chatTree/ChatTreeRows.vue',
  'chatTree/ChatTreeChatRow.vue',
  'chatTree/FolderAccessModal.vue',
  'nodeSession/CompactModal.vue',
  'nodeSession/RenameModal.vue',
  'nodeSession/ParentLink.vue',
  'nodeSession/SessionPlan.vue',
  'nodeSession/SessionMarkLine.vue',
  'nodeSession/SessionTree.vue',
  'nodeSession/SessionSettings.vue',
  'nodeSession/BackgroundTasks.vue',
  'nodeSession/types.ts',
  'github/GithubFindBar.vue',
  'github/GithubNotice.vue',
  'github/GithubBaseBar.vue',
]
afterEach(() => initializeLocale('en', testCatalogs['en' as keyof typeof testCatalogs]))
it('extracts presentation from chat controls', () => {
  for (const file of surfaces) {
    const path = `components/${file}`
    expect(checkMigrated(extract(path, readFileSync(`src/${path}`, 'utf8'))), path).toEqual([])
  }
})
it('extracts node and chat view adapter labels', () => {
  for (const file of [
    'AiSidebarView.ts',
    'NodeSidebarView.ts',
    'NodePathMainView.ts',
    'nodeFileTabActions.ts',
  ]) {
    const path = `views/${file}`
    expect(checkMigrated(extract(path, readFileSync(`src/${path}`, 'utf8'))), path).toEqual([])
  }
})
it('localizes find labels and counts while retaining query and navigation events', async () => {
  initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
  const wrapper = mount(ChatFindBar, {
    props: { query: 'sample query', count: 7, position: 2, autofocus: false },
    global: {
      stubs: {
        Search: {
          props: ['label', 'modelValue', 'suffixLabel'],
          template: '<input :aria-label="label" :value="modelValue" :title="suffixLabel" />',
        },
        Icon: { props: ['tooltip'], template: '<button :aria-label="tooltip" />' },
      },
    },
  })
  expect(wrapper.get('input').attributes('aria-label')).toBe('Найти в этом чате')
  expect(wrapper.get('input').attributes('title')).toBe('2 из 7')
  expect(wrapper.get('input').element.value).toBe('sample query')
  await wrapper.findAll('button')[1].trigger('click')
  expect(wrapper.emitted('next')).toEqual([[]])
  await wrapper.setProps({ count: 0 })
  expect(wrapper.get('input').attributes('title')).toBe('Нет результатов')
  wrapper.unmount()
})
it('keeps reasoning content unchanged in every language', () => {
  for (const [language, expected] of Object.entries({
    en: 'Thinking',
    ru: 'Думает',
    lv: 'Domā',
    es: 'Pensando',
    de: 'Denkt',
  })) {
    initializeLocale(language, testCatalogs[language as keyof typeof testCatalogs])
    const wrapper = mount(ChatThinking, {
      props: { text: 'Sample reasoning {literal}', streaming: true },
      global: {
        stubs: {
          TreeItem: { props: ['text'], template: '<section :aria-label="text"><slot /></section>' },
          Markdown: { props: ['text'], template: '<p>{{ text }}</p>' },
        },
      },
    })
    expect(wrapper.get('section').attributes('aria-label')).toBe(expected)
    expect(wrapper.get('p').text()).toBe('Sample reasoning {literal}')
    wrapper.unmount()
  }
})
it('localizes reply accessibility without altering the quoted words', () => {
  initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
  const wrapper = mount(ChatReplyCard, {
    props: { to: { messageId: 'sample-message', quote: 'Sample quoted words' }, gone: true },
    global: { stubs: { Icon: true } },
  })
  expect(wrapper.get('.abele-chat-reply-card').attributes('aria-label')).toBe(
    'Сообщение находится в другой ветке этого чата'
  )
  expect(wrapper.text()).toBe('Sample quoted words')
  wrapper.unmount()
})

it('keeps complete catalogs and records reviewed English messages', () => {
  expect(validateCatalogs(catalogs)).toEqual([])
  expect(
    Object.fromEntries(
      Object.entries({
        ...chat,
        ...repository,
        ...streamB,
        ...streamBErrors,
        ...streamBCounts,
        ...streamBMeta,
      }).map(([key, value]) => [
        key,
        createHash('sha256').update(JSON.stringify(value)).digest('hex'),
      ])
    )
  ).toEqual(
    Object.fromEntries(
      Object.entries({
        ...ledger,
        ...repositoryLedger,
        ...streamBLedger,
        ...errorLedger,
        ...countLedger,
        ...metaLedger,
      }).map(([key, entry]) => [key, entry.englishHash])
    )
  )
})
it('keeps the default continuation sent to the agent English', () => {
  for (const language of ['en', 'ru', 'lv', 'es', 'de']) {
    initializeLocale(language, testCatalogs[language as keyof typeof testCatalogs])
    const wrapper = mount(CompactModal, {
      props: { context: null, continues: true },
      global: {
        stubs: {
          Modal: { template: '<div><slot /><slot name="footer" /></div>' },
          Setting: { template: '<div><slot /></div>' },
          Checkbox: true,
          Input: true,
          Button: { props: ['text'], template: '<button>{{ text }}</button>' },
        },
      },
    })
    wrapper.findAll('button').at(-1)!.trigger('click')
    expect(wrapper.emitted('compact')).toEqual([['', 'Continue from where you stopped.']])
    wrapper.unmount()
  }
})

it.each(['Changes requested', 'changes requested', 'request changes'])(
  'keeps review identity and warning color independent of UI language: %s',
  (badge) => {
    initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
    const comment = {
      id: 1,
      body: '',
      author: 'sample-author',
      createdAt: '2025-05-14T10:00:00Z',
      badge,
    }
    const wrapper = mount(GithubComment, {
      props: { comment: comment as never },
      global: {
        stubs: {
          GithubUser: true,
          GithubText: true,
          GithubLinkActions: true,
          Badge: true,
          EmptyState: true,
          StatusDot: { name: 'StatusDot', props: ['tone', 'label'], template: '<span />' },
        },
      },
    })
    expect(wrapper.findComponent({ name: 'StatusDot' }).props('tone')).toBe('red')
    expect(wrapper.findComponent({ name: 'StatusDot' }).props('label').toLowerCase()).toBe(
      'запрошены изменения'
    )
    expect(comment.badge).toBe(badge)
    wrapper.unmount()
  }
)
it('uses locale plural rules for repository and outline counts', () => {
  initializeLocale('en', testCatalogs['en' as keyof typeof testCatalogs])
  expect(plural(1, 'file')).toBe('1 file')
  expect(plural(5, 'file')).toBe('5 files')
  expect(plural(2, 'match', 'matches')).toBe('2 matches')
  initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
  expect(plural(1, 'file')).toBe('1 файл')
  expect(plural(2, 'file')).toBe('2 файла')
  expect(plural(5, 'file')).toBe('5 файлов')
  expect(plural(21, 'file')).toBe('21 файл')
})

it('still rejects new words passed to presentation helpers', () => {
  for (const expression of [
    "plural(2, 'New label')",
    "streamBLabel('New label')",
    "presentUiField({}, 'New label')",
  ]) {
    expect(
      extract('sample.vue', `<template><span>{{ ${expression} }}</span></template>`).map(
        (item) => item.text
      )
    ).toContain('New label')
  }
  expect(
    extract(
      'sample.vue',
      '<template><span>{{ plural(2, "file") }} {{ streamBLabel("Modified") }}</span></template>'
    )
  ).toEqual([])
})
it('keeps stored defaults and GitHub errors unchanged while rendering a localized explanation', () => {
  const error = new GithubError(
    'auth',
    '',
    401,
    explainRefusal({
      status: 401,
      message: 'Sample provider response {literal}',
      hasToken: false,
      what: 'the issue',
    })
  )
  const original = error.message
  initializeLocale('en', testCatalogs['en' as keyof typeof testCatalogs])
  expect(presentUiError(error)).toBe(original)
  for (const language of ['ru', 'lv', 'es', 'de']) {
    initializeLocale(language, testCatalogs[language as keyof typeof testCatalogs])
    expect(createAgent().name).toBe('New agent')
    expect(presentUiError(error)).not.toBe(original)
    expect(presentUiError(error)).toContain('Sample provider response {literal}')
    expect(error.message).toBe(original)
    expect(error.reason).toBe('GitHub asks for a token to show the issue.')
  }
})
it('translates explicit repository metadata while retaining original fields and unknown provider messages', () => {
  const note = 'This Working tree observation expired. Refresh to inspect the current files.'
  const record = uiFields({ note }, { note: uiMessage('streamBError.b46591df0d') })
  const error = new UiError(uiMessage('streamBError.b46591df0d'))
  initializeLocale('en', testCatalogs['en' as keyof typeof testCatalogs])
  expect(presentUiField(record, 'note')).toBe(note)
  expect(error.message).toBe(note)
  initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
  expect(presentUiField(record, 'note')).toContain('устарели')
  expect(presentUiError(error)).toContain('устарели')
  expect(record).toEqual({ note })
  expect(JSON.stringify(record)).toBe(JSON.stringify({ note }))
  expect(Object.keys(record)).toEqual(['note'])
  expect(error.message).toBe(note)
  // Even a provider message equal to our English copy is not inferred to be our error code.
  expect(presentUiError(new Error(note))).toBe(note)
  expect(presentUiError('Sample provider text {literal}')).toBe('Sample provider text {literal}')
})
it('redacts credentials from localized error metadata as well as its original message', async () => {
  const token = 'sample-test-token'
  const client = new GithubClient(endpoints(''), token, async () => ({
    status: 401,
    headers: {},
    text: '',
    arrayBuffer: new ArrayBuffer(0),
    json: { message: token },
  }))
  const options = uiFields(
    { what: 'Sample ' + token },
    { what: uiMessage('streamB.theImmutableFile.98892f', { v0: token }) }
  )
  let error: unknown
  try {
    await client.get('/sample', options)
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(GithubError)
  for (const locale of ['en', 'ru', 'lv', 'es', 'de']) {
    initializeLocale(locale, testCatalogs[locale as keyof typeof testCatalogs])
    expect(presentUiError(error)).not.toContain(token)
    expect(presentUiError(error)).toContain('<hidden>')
  }
})
it('keeps the working-tree protocol reference independent of UI language', () => {
  const source = readFileSync('src/github/item/useGithubItem.ts', 'utf8')
  expect(source).not.toMatch(/sourceLocation\.ref\s*===\s*t\(/)
  expect(source).toContain('props.sourceLocation.ref === WORKING_TREE')
  expect(source).toContain('!projectPin.value ? WORKING_TREE : undefined')
})
it('keeps node scope option values independent of their translated labels', () => {
  const source = readFileSync('src/node/NodePathObsidianActions.ts', 'utf8')
  expect(source).not.toMatch(/value:\s*t\(/)
  expect(source).toContain("value: 'read'")
  expect(source).toContain("value: 'edit'")
})
it('localizes UI dates with calendar-day arithmetic and retains ISO and diagnostic timezone identities', () => {
  const timestamp = '2025-03-29T23:30:00Z'
  const options = {
    now: new Date('2025-03-30T22:15:00Z'),
    timeZone: 'Europe/Berlin',
    diagnostic: true,
  }
  initializeLocale('en', testCatalogs['en' as keyof typeof testCatalogs])
  const original = originalTimestamp(timestamp, options)
  expect(streamBTime(timestamp, options)).toMatchObject(original)
  initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
  const shown = streamBTime(timestamp, options)
  expect(shown.label).toMatch(/^вчера, /)
  expect(shown.clock).toBe('00:30')
  expect(shown.datetime).toBe(original.datetime)
  expect(shown.exact).toContain('Europe/Berlin')
  expect(streamBTime(undefined).label).toBe('Время неизвестно')
})
it('clears a retained notice when loading supplies the original patch', () => {
  const record: { note?: string } = {}
  uiField(record, 'note', uiMessage('streamBError.d2999e7b21'))
  initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
  expect(presentUiField(record, 'note')).not.toBe('')
  uiField(record, 'note', undefined)
  expect(record.note).toBeUndefined()
  expect(presentUiField(record, 'note')).toBe('')
})

it('localizes an app-owned branch failure without changing the original error', () => {
  initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
  let failure: unknown
  try {
    projectBranchCuts([], [], 'sample-missing-boundary')
  } catch (error) {
    failure = error
  }
  expect((failure as Error).message).toBe('The branch boundary no longer matches its continuation')
  expect(presentUiError(failure)).toBe('Граница ветки больше не соответствует её продолжению')
})

it('localizes a query failure while retaining the native regex diagnostic', () => {
  initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
  let failure: unknown
  try {
    compileQuery({ text: '[', regex: true })
  } catch (error) {
    failure = error
  }
  expect((failure as Error).message).toMatch(/^Not a valid regular expression: /)
  expect(presentUiError(failure)).toMatch(/^Некорректное регулярное выражение: /)
  expect(presentUiError(failure)).toContain(
    (failure as Error).message.slice('Not a valid regular expression: '.length)
  )
})

it('keeps repository link and agent titles English while localizing the header', () => {
  const target: GithubTarget = {
    kind: 'list',
    host: 'github.com',
    owner: 'sample-owner',
    repo: 'sample-project',
    list: 'pulls',
    query: 'is:open',
  }
  const data: ListData = {
    kind: 'pulls',
    query: target.query,
    counts: { open: 2, closed: 0 },
    url: '',
    items: [],
    total: 2,
    next: null,
  }
  const original = placeLink(target, data)
  initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
  expect(placeLink(target, data)).toEqual(original)
  expect(itemHead(target, data, false).title).toBe('Pull requests')
  expect(itemHead(target, data).title).toBe('Запросы на слияние')
})

it('publishes localized metadata before synchronous field observers run', () => {
  initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
  const field = ref('Sample previous failure')
  let seen = ''
  const stop = watch(
    field,
    () => {
      seen = presentUiField(field, 'value')
    },
    { flush: 'sync' }
  )
  try {
    uiField(field, 'value', uiMessage('chat.timeUnknown'))
    expect(seen).toBe(t('chat.timeUnknown'))
    expect(field.value).toBe('Time unknown')
  } finally {
    stop()
  }
})

it('translates local live-session fallbacks without changing journal projections', () => {
  initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
  const event = (seq: number, type: string, data: unknown) => ({
    kind: 'event' as const,
    node_id: 'sample-node',
    stream_id: 'sample-session',
    seq,
    type,
    data,
    actor: { kind: 'node' as const },
    at: new Date(seq * 1000).toISOString(),
  })
  const tasks = reduceTranscript([
    event(1, 'session.tasks', {
      tasks: [
        { task_id: 'sample-missing', task_type: 'local_agent', description: null },
        { task_id: 'sample-authored', task_type: 'local_agent', description: 'A background task' },
      ],
    }),
  ]).live.tasks
  expect(tasks.map((task) => task.title)).toEqual(['A background task', 'A background task'])
  const view = mount(BackgroundTasks, { props: { tasks, expanded: true, now: 1000 } })
  const rows = view.findAll('.abele-bg-tasks__task')
  expect(rows[0].text()).toContain('Фоновая задача')
  expect(rows[1].text()).toContain('A background task')
  view.unmount()
  const projection = reduceTranscript([
    event(1, 'compaction.started', {}),
    event(2, 'session.process', { state: 'exited' }),
  ])
  const mark = projection.messages.find((message) => message.sessionMark)?.sessionMark
  expect(mark?.text).toBe('it stopped with the session')
  const line = mount(SessionMarkLine, { props: { mark: mark! } })
  expect(line.text()).toContain('остановлено вместе с сессией')
  expect(mark?.text).toBe('it stopped with the session')
  line.unmount()
})

it('uses singular discussion context counts for a single message or passage', () => {
  initializeLocale('en', catalogs.en)
  expect(t('discussion.messages', { count: 1 })).toBe('1 message · words only, no tool calls')
  expect(t('discussion.passages', { count: 1 })).toBe('1 passage · selected words and sources only')
  expect(t('discussion.messages', { count: 2 })).toBe('2 messages · words only, no tool calls')
})
