<template>
  <!-- Every conversation where an agent waits for you, works, or has lost its node: rows like
       the chat history's, a dot for the state, one line of what it waits on, the time. A row
       opens its chat where it waits; agent, model, folder and source are its tooltip. -->
  <ObsidianModal title="Agents" @close="emit('close')">
    <div class="abele-agents">
      <div class="abele-agents__head">
        <Search
          v-model="query"
          class="abele-agents__field"
          label="Search conversations and agents"
          placeholder="Search…"
        />
        <Icon
          class="abele-agents__all-seen"
          icon="check-check"
          label="Mark all as seen; waiting questions and permissions stay"
          :disabled="busy || !hasDismissible"
          @click="allSeen"
        />
      </div>
      <EmptyState v-if="failure" variant="error" :text="failure" />
      <EmptyState v-if="feedback" :text="feedback" />
      <p v-if="source.status.value" class="abele-agents__status">{{ source.status.value }}</p>

      <EmptyState
        v-if="!sections.some((section) => section.rows.length)"
        class="abele-agents__empty"
        :variant="query ? 'no-matches' : 'empty'"
        :icon="query ? undefined : 'bot'"
        :text="query ? 'No matches' : 'No agents at work'"
      />
      <section v-for="section in sections.filter((s) => s.rows.length)" :key="section.title">
        <ListSectionHeader :text="section.title" :count="section.rows.length" />
        <Card
          v-for="row in section.rows"
          :key="row.key"
          :ref="(card) => describeRow(card, row)"
          class="abele-agents__row"
          :class="{ 'abele-agents__row_unavailable': unavailable(row) }"
          :title="row.title"
          :subtitle="said(row)"
          :meta="[when(row)]"
          :clickable="!unavailable(row)"
          @click="open(row, primary(row).kind === 'question')"
          @keydown.space.self.prevent="
            !unavailable(row) && open(row, primary(row).kind === 'question')
          "
        >
          <template #badges>
            <StatusDot :tone="tone(row)" :pulse="tone(row) === 'accent'" :label="label(row)" />
          </template>
          <template v-if="dismissible(row).length || reconnectable(row)" #actions>
            <Icon
              v-if="reconnectable(row)"
              class="abele-agents__reconnect"
              icon="refresh-cw"
              tooltip="Reconnect to this node; does not restart work"
              :disabled="busy"
              @click="reconnect(row)"
            />
            <Icon
              v-for="reason in dismissible(row)"
              :key="reason.id"
              class="abele-agents__seen"
              :icon="reason.kind === 'error' ? 'check' : 'x'"
              :tooltip="actionLabel(reason)"
              :disabled="busy"
              @click="seen(row, reason.id)"
            />
          </template>
        </Card>
      </section>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import Card from './obsidian/Card.vue'
import StatusDot from './obsidian/StatusDot.vue'
import ListSectionHeader from './obsidian/ListSectionHeader.vue'
import EmptyState from './obsidian/EmptyState.vue'
import Icon from './obsidian/Icon.vue'
import Search from './obsidian/Search.vue'
import { setTooltip } from 'obsidian'
import dayjs from 'dayjs'
import { AgentsService } from '@/agents/AgentsService'
import {
  canDismissAttention,
  needsAttention,
  reasonLabel,
  type AttentionRow,
  type AttentionReason,
} from '@/agents/attention'
const actionLabel = (reason: AttentionReason) =>
  `${reason.kind === 'error' ? 'Mark as seen' : 'Dismiss'} · ${reasonLabel(reason)}`
const unavailable = (row: AttentionRow) => row.reference.kind === 'node' && !row.reference.sessionId
const props = defineProps<{
  source?: Pick<AgentsService, 'rows' | 'incomplete' | 'status' | 'open' | 'markSeen'> &
    Partial<Pick<AgentsService, 'reconnect' | 'markAllSeen'>>
}>()
const source = props.source ?? AgentsService.getInstance()
const emit = defineEmits<{ (e: 'close'): void }>()
const query = ref(''),
  failure = ref(''),
  feedback = ref(''),
  busy = ref(false)
/** Who and where, for the row's tooltip: what used to be four labelled facts under every title. */
const facts = (row: AttentionRow) =>
  [row.agent, row.model, row.folder, row.source].filter(Boolean).join(' · ')
const describeRow = (card: unknown, row: AttentionRow) => {
  const el = (card as { $el?: HTMLElement } | null)?.$el
  if (el) setTooltip(el, `${facts(row)}\n${age(row)}`, { placement: 'top' })
}
const sections = computed(() => {
  const rows = source.rows.value.filter((r) =>
    `${r.title} ${r.agent} ${r.model ?? ''} ${r.folder ?? ''} ${r.source} ${r.quote ?? ''}`
      .toLocaleLowerCase()
      .includes(query.value.toLocaleLowerCase())
  )
  return [
    { title: 'Waiting for you', rows: rows.filter((r) => r.reasons.some(needsAttention)) },
    {
      title: 'Working',
      rows: rows.filter(
        (r) => !r.reasons.some(needsAttention) && r.reasons.some((s) => s.kind === 'running')
      ),
    },
    {
      title: 'Offline',
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
/** The row's dot: orange waits for you, red failed, accent pulses while working, faint offline. */
const tone = (row: AttentionRow) => {
  const reason = primary(row)
  if (reason.uncertain || reason.interrupted || reason.kind === 'interrupted') return 'faint'
  if (reason.kind === 'error') return 'red'
  if (reason.kind === 'running') return 'accent'
  if (reason.kind === 'delivery') return 'faint'
  return 'orange'
}
/** What it waits on, in one line: the question itself, the action asked for, what failed. */
const said = (row: AttentionRow) => {
  const approvals = row.reasons.filter((r) => r.kind === 'approval').length
  if (approvals > 1) return `${approvals} permissions`
  const reason = primary(row)
  if (reason.uncertain) return reasonLabel(reason)
  return reason.text || reasonLabel(reason)
}
/** Since when, as a time today and a date before. */
const when = (row: AttentionRow) => {
  const at = primary(row).at
  if (!at) return ''
  return dayjs(at).isSame(dayjs(), 'day') ? dayjs(at).format('HH:mm') : dayjs(at).format('D MMM')
}
const dismissible = (row: AttentionRow) => row.reasons.filter(canDismissAttention)
const reconnectable = (row: AttentionRow) =>
  row.reference.kind === 'node' && row.reasons.some((r) => r.kind === 'delivery')
const label = (row: AttentionRow) => {
  const approvals = row.reasons.filter((r) => r.kind === 'approval').length
  const reason = primary(row)
  if (reason.kind === 'question' && !reason.interrupted && !reason.uncertain)
    return `Waiting for a reply · ${reasonLabel(reason)}`
  return approvals > 1 ? `Waiting for ${approvals} permissions` : reasonLabel(reason)
}
const age = (row: AttentionRow) => {
  const at = primary(row).at
  return at
    ? `Since ${new Date(at).toLocaleString()}${row.updatedAt ? ` · Last confirmed: ${new Date(row.updatedAt).toLocaleString()}` : ''}`
    : 'Waiting time unknown'
}
const open = async (row: AttentionRow, reply = false) => {
  failure.value = ''
  try {
    const opened = reply
      ? await source.open(row, primary(row), { focusComposer: true })
      : await source.open(row, primary(row))
    if (opened) emit('close')
  } catch (error) {
    failure.value = error instanceof Error ? error.message : 'Conversation unavailable'
  }
}
const reconnect = async (row: AttentionRow) => {
  busy.value = true
  failure.value = ''
  try {
    await (source.reconnect ?? ((r) => AgentsService.getInstance().reconnect(r)))(row)
    feedback.value = `${row.title} · Connected. Sessions may still be unavailable.`
  } catch (error) {
    failure.value = error instanceof Error ? error.message : 'Could not reconnect'
  } finally {
    busy.value = false
  }
}
const hasDismissible = computed(() =>
  source.rows.value.some(
    (row) =>
      row.reference.kind === 'local' &&
      row.reasons.some((reason) => ['error', 'interrupted'].includes(reason.kind))
  )
)
const allSeen = async () => {
  busy.value = true
  failure.value = ''
  try {
    if (source.markAllSeen) await source.markAllSeen()
    else
      for (const row of [...source.rows.value])
        if (row.reference.kind === 'local')
          for (const reason of row.reasons)
            if (['error', 'interrupted'].includes(reason.kind))
              await source.markSeen(row, reason.id)
  } catch (error) {
    failure.value = error instanceof Error ? error.message : 'Could not save the acknowledgements'
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
    failure.value = error instanceof Error ? error.message : 'Could not save the acknowledgement'
  } finally {
    busy.value = false
  }
}
</script>
<style lang="scss">
.abele-agents {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  min-width: 0;
}
/* The cards of a group apart as the chat history's are, and the groups further apart than
   the cards inside them. */
.abele-agents > section {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}
.abele-agents > section + section {
  margin-top: var(--size-4-4);
}
.abele-agents .abele-list-section-header {
  margin: 0;
}
.abele-agents__head + section,
.abele-agents__head ~ .abele-empty-state + section {
  margin-top: var(--size-4-2);
}
/* The dot stays at the end of the title's first line, as in the chat history: a long title
   wraps inside its own box instead of pushing the dot onto a line of its own. */
.abele-agents .abele-card__title {
  flex-wrap: nowrap;
  align-items: flex-start;
  /* The name's own step, so the dot's line below is the name's line. */
  font-size: var(--font-ui-small);
  line-height: var(--line-height-tight);
}
.abele-agents .abele-card__name {
  min-width: 0;
}
.abele-agents .abele-card__title > .abele-status-dot {
  margin-top: calc((1lh - var(--size-4-2)) / 2);
}
/* What it waits on and when, one block under the name at the same step. */
.abele-agents .abele-card__meta {
  margin-top: 0;
}
.abele-agents__head {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
}
.abele-agents__field {
  flex: 1 1 auto;
}
.abele-agents__status {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
// A node's session that is not there to open reads faint and takes no click.
.abele-agents__row_unavailable {
  color: var(--text-faint);
}
</style>
