import { ref } from 'vue'
import type { AttentionRow } from '@/agents/attention'

export type AgentsFixtureState = 'empty' | 'waiting' | 'many' | 'working' | 'error' | 'mixed'
/** Invented states exercise the real list without opening conversations or providers. */
export function agentsFixture(state: AgentsFixtureState = 'mixed') {
  const at = Date.now() - 15 * 60_000
  const waiting: AttentionRow = {
    key: 'sample-question',
    reference: { kind: 'local', path: 'Chats/sample-question.abchat' },
    title: 'Выбор папки для пробных заметок',
    agent: 'Пробный исследователь',
    model: 'Sample model',
    folder: 'Sample work',
    source: 'Чат · На этом устройстве',
    reasons: [
      {
        kind: 'question',
        id: 'sample-question',
        at,
        text: 'В какую папку сохранить пробные заметки?',
      },
    ],
  }
  const approval: AttentionRow = {
    ...waiting,
    key: 'sample-approvals',
    reference: { kind: 'local', path: 'Chats/sample-approvals.abchat' },
    title:
      'Длинное пробное название разговора о саде, сезонных растениях и плане следующих наблюдений',
    agent: 'Пробный помощник с длинным именем',
    folder: 'Sample work/An intentionally long invented folder name',
    reasons: ['one', 'two', 'three'].map((id) => ({
      kind: 'approval',
      id,
      at,
      text: 'Изменение пробного файла',
    })),
  }
  const error: AttentionRow = {
    ...waiting,
    key: 'sample-discussion',
    reference: { kind: 'local', path: 'Comments/sample.abchat', commentId: 'sample' },
    title: 'Пробное обсуждение главы',
    agent: 'Пробный редактор',
    source: 'Обсуждение · Notes/sample-chapter.md',
    quote:
      'Пробный отрывок достаточно длинный, чтобы переноситься на несколько строк на узком экране без обрезания.',
    reasons: [
      {
        kind: 'error',
        id: 'sample-error',
        at,
        text: 'Не удалось прочитать пробный файл. Запуск остановлен.',
      },
    ],
  }
  const working: AttentionRow = {
    ...waiting,
    key: 'sample-working',
    reference: { kind: 'local', path: 'Chats/working.abchat' },
    title: 'Проверка пробных заметок',
    agent: 'Пробный проверяющий',
    reasons: [{ kind: 'running', id: 'sample-run', at }],
  }
  const node: AttentionRow = {
    key: 'sample-node',
    reference: {
      kind: 'node',
      nodeId: 'sample-node',
      registrationId: 'sample-registration',
      sessionId: '',
    },
    title: 'Пробный узел',
    agent: 'Node',
    source: 'Node · Пробный узел',
    reasons: [
      {
        kind: 'delivery',
        id: 'sample-connection',
        at: 0,
        text: 'Сводка сессий Node недоступна · Данные неполны',
      },
    ],
  }
  const rows =
    state === 'empty'
      ? []
      : state === 'waiting'
        ? [waiting]
        : state === 'working'
          ? [working]
          : state === 'error'
            ? [error]
            : state === 'many'
              ? [
                  approval,
                  {
                    ...waiting,
                    title:
                      'Длинный пробный вопрос о выборе папки для черновиков и дальнейшего обсуждения главы',
                    agent: 'Пробный исследователь с очень длинным именем',
                  },
                  error,
                  working,
                ]
              : [waiting, working, node]
  return {
    rows: ref(rows),
    incomplete: ref(state === 'mixed'),
    status: ref(state === 'mixed' ? 'Данные Node неполны' : ''),
    open: async () => false,
    markSeen: async () => {},
    reconnect: async () => {},
  }
}
