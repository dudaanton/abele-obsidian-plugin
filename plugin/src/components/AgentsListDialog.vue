<template>
  <ObsidianModal title="Агенты" @close="emit('close')">
    <div class="abele-agents">
      <input v-model="query" type="search" aria-label="Поиск агентов" placeholder="Поиск" />
      <p v-if="failure" role="alert">{{ failure }}</p>
      <section v-for="section in sections" :key="section.title">
        <h3>{{ section.title }}</h3>
        <p v-if="section.title === 'Связь и доставка' && source.incomplete.value" role="status">
          {{ source.status.value || 'Данные неполны' }}
        </p>
        <p v-if="!section.rows.length" class="abele-agents__empty">Нет разговоров</p>
        <div v-for="row in section.rows" :key="row.key" class="abele-agents__row tree-item">
          <div
            class="abele-agents__open tree-item-self"
            role="button"
            :tabindex="unavailable(row) ? -1 : 0"
            :aria-disabled="unavailable(row)"
            @click="!unavailable(row) && open(row)"
            @keydown.enter.prevent="!unavailable(row) && open(row)"
            @keydown.space.prevent="!unavailable(row) && open(row)"
          >
            <div class="abele-agents__content tree-item-inner">
              <span class="abele-agents__title">{{ row.title }}</span>
              <span class="abele-agents__metadata">{{ row.agent }} · {{ row.source }}</span>
              <span class="abele-agents__metadata">{{ label(row) }}</span>
            </div>
          </div>
          <div class="abele-agents__details-row">
            <details class="abele-agents__details">
              <summary>Детали</summary>
              <p v-if="row.quote">{{ row.quote }}</p>
              <p>{{ age(row) }}</p>
            </details>
            <div v-if="row.reasons.some(canDismissAttention)" class="abele-agents__actions">
              <button
                v-for="reason in row.reasons.filter(canDismissAttention)"
                :key="reason.id"
                v-attention-icon="reason"
                class="abele-agents__seen clickable-icon"
                :aria-label="actionLabel(reason)"
                :disabled="busy"
                @click="seen(row, reason.id)"
              >
                <span aria-hidden="true" class="abele-agents__action-label">{{
                  reason.kind === 'error' ? 'Просмотрено' : 'Убрать'
                }}</span>
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  </ObsidianModal>
</template>
<script setup lang="ts">
import { computed, ref, type ObjectDirective } from 'vue'
import { setIcon, setTooltip } from 'obsidian'
import ObsidianModal from './obsidian/Modal.vue'
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
const updateAction = (el: HTMLElement, reason: AttentionReason) => {
  let glyph = el.querySelector<HTMLElement>('.abele-agents__action-icon')
  if (!glyph) {
    glyph = el.createSpan({
      cls: 'abele-agents__action-icon',
      attr: { 'aria-hidden': 'true' },
    })
  }
  setIcon(glyph, reason.kind === 'error' ? 'check' : 'x')
  setTooltip(el, actionLabel(reason))
}
const vAttentionIcon: ObjectDirective<HTMLElement, AttentionReason> = {
  mounted: (el, binding) => updateAction(el, binding.value),
  updated: (el, binding) => updateAction(el, binding.value),
}
const unavailable = (row: AttentionRow) => row.reference.kind === 'node' && !row.reference.sessionId
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
.abele-agents h3 {
  font-size: var(--font-ui-small);
  margin: var(--size-4-2) 0;
}
.abele-agents__empty {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  margin: var(--size-4-2) 0;
}
.abele-agents__row {
  margin-bottom: var(--size-4-2);
  min-width: 0;
}
.abele-agents__open {
  align-items: flex-start;
  padding-inline-start: var(--size-4-2);
  white-space: normal;
}
.abele-agents__content {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
}
.abele-agents__title {
  color: var(--text-normal);
}
.abele-agents__metadata,
.abele-agents__details {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.abele-agents__details-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--size-4-1);
  padding: 0 var(--size-4-2);
}
.abele-agents__details {
  flex: 1 1 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.abele-agents__details summary {
  width: fit-content;
  cursor: var(--cursor-link);
}
.abele-agents__details p {
  margin: var(--size-4-1) 0;
}
.abele-agents__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-1);
  max-width: 100%;
}
.abele-agents__action-label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
body.is-mobile .abele-agents__seen,
body.is-mobile .abele-agents__details summary {
  min-width: var(--touch-size-m);
  min-height: var(--touch-size-m);
}
</style>
