<template>
  <details v-if="entries.length" class="abele-chat-bindings" :open="needsRecovery">
    <summary>Card links · {{ entries.length }}</summary>
    <div class="abele-chat-binding-list">
      <div v-for="entry in entries" :key="key(entry)" class="setting-item mod-action">
        <div class="setting-item-info">
          <div class="setting-item-name">
            {{ entry.snapshot?.text ?? entry.operation?.patch.before ?? 'Card link' }}
          </div>
          <div class="setting-item-description">{{ entry.targetPath }} · {{ entry.status }}</div>
          <details v-if="entry.evidence">
            <summary>Details</summary>
            <p>{{ entry.evidence }}</p>
            <p v-if="entry.status === 'uncertain'">
              Keep the card. Reopen this conversation to inspect persisted source. An uncertain
              publication is never retried automatically.
            </p>
          </details>
        </div>
        <div class="setting-item-control">
          <button
            type="button"
            class="clickable-icon"
            aria-label="Card link actions"
            aria-haspopup="menu"
            @click="actions(entry, $event)"
          >
            <Icon icon="ellipsis" no-hover />
          </button>
        </div>
      </div>
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Menu, Notice, TFile } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import type { ChatSession } from '@/ai/ChatSession'
import { ChatSelectionBindings } from '@/ai/chatBindings'
import { anchorBacklink } from '@/selection/anchorLinks'
import type { SelectionBindingRecovery } from '@/selection/bindings'
import { GlobalStore } from '@/stores/GlobalStore'

const props = defineProps<{ session: ChatSession }>()
const entries = computed(() => props.session.bindingRecoveries.value)
const needsRecovery = computed(() =>
  entries.value.some((entry) => entry.status !== 'applied' && entry.status !== 'undone')
)
const key = (entry: SelectionBindingRecovery) => entry.id ?? entry.operation?.id ?? entry.targetPath
const run = (work: () => Promise<unknown>) =>
  void work().catch(
    (error) => new Notice(error instanceof Error ? error.message : String(error), 10000)
  )
function actions(entry: SelectionBindingRecovery, event: MouseEvent) {
  const { app } = GlobalStore.getInstance()
  const menu = new Menu()
  menu.addItem((item) =>
    item
      .setTitle('Open card')
      .setIcon('file')
      .onClick(() => {
        const target = app.vault.getAbstractFileByPath(entry.targetPath)
        if (!(target instanceof TFile)) {
          new Notice(`The card at ${entry.targetPath} is unavailable`)
          return
        }
        void app.workspace.openLinkText(
          entry.targetPath,
          props.session.currentChatFile.value?.path ?? ''
        )
      })
  )
  const source = entry.snapshot?.source ?? entry.operation?.captured
  const anchorId = entry.anchorId ?? entry.operation?.anchorId
  if (source && anchorId)
    menu.addItem((item) =>
      item
        .setTitle('Copy source link')
        .setIcon('link')
        .onClick(() =>
          run(async () => {
            await navigator.clipboard.writeText(
              anchorBacklink(props.session.currentChatFile.value?.path ?? '', {
                chatId: source.chatId,
                anchorId,
              })
            )
            new Notice('Source link copied')
          })
        )
    )
  if (entry.status === 'applied')
    menu.addItem((item) =>
      item
        .setTitle('Remove link (undo binding)')
        .setIcon('undo-2')
        .onClick(() =>
          run(async () => {
            await new ChatSelectionBindings(props.session).undo(key(entry))
            new Notice('Link removed. The card was kept.')
          })
        )
    )
  if (entry.status === 'pending' || entry.status === 'known-not-written')
    menu.addItem((item) =>
      item
        .setTitle('Retry binding only')
        .setIcon('rotate-cw')
        .onClick(() =>
          run(async () => {
            const result = await new ChatSelectionBindings(props.session).retry(key(entry))
            new Notice(
              result.status === 'applied' ? 'Card linked' : (result.reason ?? result.status),
              10000
            )
          })
        )
    )
  menu.showAtMouseEvent(event)
}
</script>

<style scoped>
.abele-chat-bindings {
  margin: var(--size-4-2);
}
.abele-chat-binding-list {
  max-height: 30vh;
  overflow-y: auto;
}
.abele-chat-bindings .setting-item {
  display: flex;
  flex-direction: row;
  gap: var(--size-4-2);
  padding: var(--size-4-2);
}
.abele-chat-bindings .setting-item-control {
  flex: 0 0 auto;
  width: auto;
  margin: 0;
}
.setting-item-info {
  min-width: 0;
  overflow-wrap: anywhere;
}
.abele-chat-bindings p {
  margin-block: var(--size-4-2);
}
.is-mobile .abele-chat-bindings summary {
  min-height: var(--size-4-12);
  align-content: center;
}
.is-mobile .abele-chat-bindings .clickable-icon {
  min-width: var(--size-4-12);
  min-height: var(--size-4-12);
}
</style>
