<template>
  <section class="abele-node-delegation" :aria-label="t('streamB.nodeDelegation.f2834f')">
    <Setting
      :name="card.title"
      :desc="`${nodeLabel} · ${providerLabel(card.provider)} · ${card.state}`"
    >
      <Button
        v-if="card.sessionId"
        :text="t('streamB.openChildChat.8ed00f')"
        @click="emit('open')"
      />
    </Setting>
    <p v-if="card.pendingHumanPrompts">
      {{ t('streamBMeta.1f8e74f453', { p0: String(card.pendingHumanPrompts) }) }}
    </p>
    <template v-for="report in card.reports" :key="report.seq">
      <details v-if="report.kind === 'progress'">
        <summary>{{ t('streamB.progress.466482') }}</summary>
        <p class="abele-node-delegation__report">{{ report.text }}</p>
      </details>
      <div v-else :data-mailbox-seq="report.seq">
        <strong>{{
          report.kind === 'result'
            ? t('streamB.result.6e7d50')
            : t('streamB.workerQuestionInformational.12931f')
        }}</strong>
        <p class="abele-node-delegation__report">{{ report.text }}</p>
      </div>
    </template>
  </section>
</template>
<script setup lang="ts">
import { t } from '@/i18n'
import type { DelegationCard } from '@/node/delegation'
import { providerLabel } from '@/node/providers'
import Setting from './obsidian/Setting.vue'
import Button from './obsidian/Button.vue'
defineProps<{ card: DelegationCard; nodeLabel: string }>()
const emit = defineEmits<{ open: [] }>()
</script>
<style scoped>
.abele-node-delegation {
  min-width: 0;
  padding: var(--size-4-2);
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  margin-block: var(--size-4-2);
  overflow-wrap: anywhere;
}
.abele-node-delegation__report {
  white-space: pre-wrap;
}
</style>
