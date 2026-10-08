<template>
  <ObsidianModal title="Агенты" size="tall" @close="emit('close')">
    <div class="abele-agents">
      <input v-model="query" type="search" aria-label="Поиск агентов" placeholder="Поиск" />
      <p v-if="failure" role="alert">{{ failure }}</p>
      <section v-for="section in sections" :key="section.title">
        <h3>{{ section.title }}</h3>
        <p v-if="section.title === 'Связь и доставка' && source.incomplete.value" role="status">
          {{ source.status.value || 'Данные неполны' }}
        </p>
        <p v-if="!section.rows.length">Нет разговоров</p>
        <div v-for="row in section.rows" :key="row.key" class="abele-agents__row">
          <button
            class="abele-agents__open"
            :disabled="row.reference.kind === 'node' && !row.reference.sessionId"
            @click="open(row)"
          >
            <strong>{{ row.title }} · {{ row.agent }}</strong>
            <span>{{ row.source }}</span>
            <span v-if="row.quote">{{ row.quote }}</span>
            <span>{{ label(row) }}</span>
            <span>{{ age(row) }}</span>
          </button>
          <button
            v-for="reason in row.reasons.filter(canDismissAttention)"
            :key="reason.id"
            class="abele-agents__seen"
            :disabled="busy"
            @click="seen(row, reason.id)"
            v-text="reason.kind === 'error' ? 'Просмотрено' : 'Убрать'"
          />
        </div>
      </section>
    </div>
  </ObsidianModal>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import { AgentsService } from '@/agents/AgentsService'
import {
  canDismissAttention,
  needsAttention,
  reasonLabel,
  type AttentionRow,
} from '@/agents/attention'
const props = defineProps<{
  source?: Pick<AgentsService, 'rows' | 'incomplete' | 'status' | 'open' | 'markSeen'>
}>()
const source = props.source ?? AgentsService.getInstance()
const emit = defineEmits<{ (e: 'close'): void }>()
const query = ref(''),
  failure = ref(''),
  busy = ref(false)
const sections = computed(() => {
  const rows = source.rows.value.filter((r) =>
    `${r.title} ${r.agent} ${r.source} ${r.quote ?? ''}`
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
const label = (row: AttentionRow) => {
  const approvals = row.reasons.filter((r) => r.kind === 'approval').length
  return approvals > 1 ? `Ждёт ${approvals} разрешения` : reasonLabel(primary(row))
}
const age = (row: AttentionRow) => {
  const at = primary(row).at
  return at
    ? `С ${new Date(at).toLocaleString()}${row.updatedAt ? ` · Последнее подтверждение: ${new Date(row.updatedAt).toLocaleString()}` : ''}`
    : 'Время ожидания неизвестно'
}
const open = async (row: AttentionRow) => {
  try {
    if (await source.open(row, primary(row))) emit('close')
  } catch (error) {
    failure.value = error instanceof Error ? error.message : 'Разговор недоступен'
  }
}
const seen = async (row: AttentionRow, id: string) => {
  busy.value = true
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
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
  min-width: 0;
}
.abele-agents input {
  width: 100%;
}
.abele-agents__row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--size-4-2);
  margin-bottom: var(--size-4-3);
}
.abele-agents__open {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--size-4-1);
  height: auto;
  width: 100%;
  white-space: normal;
  text-align: start;
  overflow-wrap: anywhere;
  padding: var(--size-4-2);
}
.abele-agents__open span {
  color: var(--text-muted);
}
</style>
