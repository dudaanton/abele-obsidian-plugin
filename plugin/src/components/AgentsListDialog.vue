<template>
  <ObsidianModal title="Агенты" @close="emit('close')">
    <div class="abele-agents">
      <Input
        v-model="query"
        type="search"
        aria-label="Поиск разговоров и агентов"
        placeholder="Поиск разговоров и агентов"
      />
      <EmptyState
        text="Ожидания и работа в разговорах. Цифры считают строки, не запросы. Нажми название, чтобы открыть разговор."
      />
      <EmptyState v-if="failure" variant="error" :text="failure" />
      <EmptyState v-if="feedback" :text="feedback" />
      <section v-for="section in sections" :key="section.title">
        <ListSectionHeader :text="section.title" :count="section.rows.length" />
        <EmptyState
          v-if="section.title === 'Связь и доставка' && source.incomplete.value"
          :text="source.status.value || 'Данные неполны'"
        />
        <EmptyState
          v-if="!section.rows.length"
          :variant="query ? 'no-matches' : 'empty'"
          :text="query ? 'Нет совпадений' : 'Нет разговоров'"
        />
        <ListRow
          v-for="row in section.rows"
          :key="row.key"
          :title="row.title"
          icon="bot"
          :interactive="!unavailable(row)"
          :facts="facts(row)"
          :state="state(row)"
          :message="label(row)"
          @open="open(row)"
        >
          <template #recovery>
            <Icon
              v-if="primary(row).kind === 'question' && !unavailable(row)"
              icon="message-square"
              text-right="Ответить в чате"
              tooltip="Открыть чат на ожидающем вопросе и поставить курсор в поле ответа"
              :disabled="busy"
              @click="open(row, true)"
            />
            <Icon
              v-if="primary(row).kind === 'approval' && !unavailable(row)"
              icon="shield-check"
              text-right="Рассмотреть в чате"
              tooltip="Открыть разговор на запросе разрешения; ничего не разрешает из списка"
              @click="open(row)"
            />
            <EmptyState
              v-if="row.reference.kind === 'node' && row.reasons.some((r) => r.kind === 'delivery')"
              text="Только подключение к узлу; работа не перезапускается. Сводка сессий может остаться недоступной."
            />
            <Icon
              v-if="row.reference.kind === 'node' && row.reasons.some((r) => r.kind === 'delivery')"
              icon="refresh-cw"
              text-right="Восстановить связь"
              tooltip="Повторное подключение к Node; не перезапускает работу"
              :disabled="busy"
              @click="reconnect(row)"
            />
            <Icon
              class="abele-agents__details-toggle"
              :icon="expanded.has(row.key) ? 'chevron-down' : 'chevron-right'"
              :text-right="
                primary(row).kind === 'error' ? 'Ошибка и отметка «Просмотрено»' : 'Детали и время'
              "
              tooltip="Показать или скрыть детали запроса и время"
              :aria-expanded="expanded.has(row.key)"
              :aria-controls="`agents-detail-${row.key}`"
              @click="toggleDetails(row.key, !expanded.has(row.key))"
            />
          </template>
          <template v-if="expanded.has(row.key)" #detail>
            <div :id="`agents-detail-${row.key}`">
              <Quote v-if="row.quote" :text="row.quote" />
              <p class="setting-item-description">{{ age(row) }}</p>
              <p class="setting-item-description">
                Папка — расположение разговора или заметки обсуждения.
              </p>
              <Icon
                v-for="reason in row.reasons.filter(canDismissAttention)"
                :key="reason.id"
                class="abele-agents__seen"
                :icon="reason.kind === 'error' ? 'check' : 'x'"
                :text-right="reason.kind === 'error' ? 'Просмотрено' : 'Убрать'"
                :tooltip="actionLabel(reason)"
                :disabled="busy"
                @click="seen(row, reason.id)"
              />
            </div>
          </template>
        </ListRow>
      </section>
    </div>
  </ObsidianModal>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import ListRow from './obsidian/ListRow.vue'
import ListSectionHeader from './obsidian/ListSectionHeader.vue'
import Input from './obsidian/Input.vue'
import EmptyState from './obsidian/EmptyState.vue'
import Icon from './obsidian/Icon.vue'
import Quote from './obsidian/Quote.vue'
import { AgentsService } from '@/agents/AgentsService'
import {
  canDismissAttention,
  needsAttention,
  reasonLabel,
  type AttentionRow,
  type AttentionReason,
} from '@/agents/attention'
const actionLabel = (reason: AttentionReason) =>
  `${reason.kind === 'error' ? 'Просмотрено' : 'Убрать'} · ${reasonLabel(reason)}`
const unavailable = (row: AttentionRow) => row.reference.kind === 'node' && !row.reference.sessionId
const props = defineProps<{
  source?: Pick<AgentsService, 'rows' | 'incomplete' | 'status' | 'open' | 'markSeen'> &
    Partial<Pick<AgentsService, 'reconnect'>>
}>()
const source = props.source ?? AgentsService.getInstance()
const emit = defineEmits<{ (e: 'close'): void }>()
const query = ref(''),
  failure = ref(''),
  feedback = ref(''),
  busy = ref(false),
  expanded = ref(new Set<string>())
const toggleDetails = (key: string, value: boolean) => {
  if (value) expanded.value.add(key)
  else expanded.value.delete(key)
}
const facts = (row: AttentionRow) => [
  { key: 'agent', label: 'Агент', value: row.agent },
  { key: 'model', label: 'Модель', value: row.model, required: true, unknown: 'Неизвестна' },
  { key: 'where', label: 'Папка', value: row.folder, required: true, unknown: 'Неизвестна' },
  { key: 'source', label: 'Источник', value: row.source },
]
const sections = computed(() => {
  const rows = source.rows.value.filter((r) =>
    `${r.title} ${r.agent} ${r.model ?? ''} ${r.folder ?? ''} ${r.source} ${r.quote ?? ''}`
      .toLocaleLowerCase()
      .includes(query.value.toLocaleLowerCase())
  )
  return [
    { title: 'Нужно твоё действие', rows: rows.filter((r) => r.reasons.some(needsAttention)) },
    {
      title: 'Работают',
      rows: rows.filter(
        (r) => !r.reasons.some(needsAttention) && r.reasons.some((s) => s.kind === 'running')
      ),
    },
    {
      title: 'Связь и доставка',
      rows: rows.filter(
        (r) => !r.reasons.some(needsAttention) && !r.reasons.some((s) => s.kind === 'running')
      ),
    },
  ]
})
const primary = (row: AttentionRow) =>
  row.reasons.find((r) => r.kind === 'approval') ??
  row.reasons.find(needsAttention) ??
  row.reasons[0]
const state = (row: AttentionRow) => {
  const reason = primary(row)
  if (reason.uncertain || reason.interrupted || reason.kind === 'interrupted') return 'missing'
  if (reason.kind === 'error') return 'error'
  if (reason.kind === 'running') return 'loading'
  if (reason.kind === 'delivery') return 'missing'
  return 'waiting'
}
const label = (row: AttentionRow) => {
  const approvals = row.reasons.filter((r) => r.kind === 'approval').length
  const reason = primary(row)
  if (reason.kind === 'question' && !reason.interrupted && !reason.uncertain)
    return `Ждёт ответа · ${reasonLabel(reason)}`
  return approvals > 1 ? `Ждёт ${approvals} разрешения` : reasonLabel(reason)
}
const age = (row: AttentionRow) => {
  const at = primary(row).at
  return at
    ? `С ${new Date(at).toLocaleString()}${row.updatedAt ? ` · Последнее подтверждение: ${new Date(row.updatedAt).toLocaleString()}` : ''}`
    : 'Время ожидания неизвестно'
}
const open = async (row: AttentionRow, reply = false) => {
  failure.value = ''
  try {
    const opened = reply
      ? await source.open(row, primary(row), { focusComposer: true })
      : await source.open(row, primary(row))
    if (opened) emit('close')
  } catch (error) {
    failure.value = error instanceof Error ? error.message : 'Разговор недоступен'
  }
}
const reconnect = async (row: AttentionRow) => {
  busy.value = true
  failure.value = ''
  try {
    await (source.reconnect ?? ((r) => AgentsService.getInstance().reconnect(r)))(row)
    feedback.value = `${row.title} · Связь восстановлена. Сводка сессий по-прежнему может быть неполной.`
  } catch (error) {
    failure.value = error instanceof Error ? error.message : 'Не удалось восстановить связь'
  } finally {
    busy.value = false
  }
}
const seen = async (row: AttentionRow, id: string) => {
  busy.value = true
  failure.value = ''
  try {
    await source.markSeen(row, id)
  } catch (error) {
    failure.value = error instanceof Error ? error.message : 'Не удалось сохранить отметку'
  } finally {
    busy.value = false
  }
}
</script>
<style>
.abele-agents {
  min-width: 0;
}
</style>
