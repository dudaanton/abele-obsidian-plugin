<template>
  <details v-if="entries.length" class="abele-chat-bindings" :open="needsRecovery">
    <summary>{{ t('streamBMeta.7408127a4b', { p0: String(entries.length) }) }}</summary>
    <div class="abele-chat-binding-list">
      <div v-for="entry in entries" :key="key(entry)" class="setting-item mod-action">
        <div class="setting-item-info">
          <div class="setting-item-name">
            {{
              entry.snapshot?.text ?? entry.operation?.patch.before ?? t('streamB.cardLink.e7a4fe')
            }}
          </div>
          <div class="setting-item-description">
            {{ entry.targetPath }} · {{ streamBLabel(entry.status) }}
          </div>
          <details v-if="entry.evidence">
            <summary>{{ t('streamB.details.45989d') }}</summary>
            <p>{{ entry.evidence }}</p>
            <p v-if="entry.status === 'uncertain'">
              {{ t('streamB.keepTheCardReopenThisConversationTo.8fc2a0') }}
            </p>
          </details>
        </div>
        <div class="setting-item-control">
          <button
            type="button"
            class="clickable-icon"
            :aria-label="t('streamB.cardLinkActions.92a67e')"
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
import { streamBLabel } from '@/i18n/streamBLabels'
import { presentUiError } from '@/i18n/streamBErrors'
import { t } from '@/i18n'
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
  void work().catch((error) => new Notice(presentUiError(error), 10000))
function actions(entry: SelectionBindingRecovery, event: MouseEvent) {
  const { app } = GlobalStore.getInstance()
  const menu = new Menu()
  menu.addItem((item) =>
    item
      .setTitle(t('streamB.openCard.4fc58b'))
      .setIcon('file')
      .onClick(() => {
        const target = app.vault.getAbstractFileByPath(entry.targetPath)
        if (!(target instanceof TFile)) {
          new Notice(t('streamB.theCardAtIsUnavailable.0b6d01', { v0: String(entry.targetPath) }))
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
        .setTitle(t('streamB.copySourceLink.e877eb'))
        .setIcon('link')
        .onClick(() =>
          run(async () => {
            await navigator.clipboard.writeText(
              anchorBacklink(props.session.currentChatFile.value?.path ?? '', {
                chatId: source.chatId,
                anchorId,
              })
            )
            new Notice(t('streamB.sourceLinkCopied.606e32'))
          })
        )
    )
  if (entry.status === 'applied')
    menu.addItem((item) =>
      item
        .setTitle(t('streamB.removeLinkUndoBinding.caca98'))
        .setIcon('undo-2')
        .onClick(() =>
          run(async () => {
            await new ChatSelectionBindings(props.session).undo(key(entry))
            new Notice(t('streamB.linkRemovedTheCardWasKept.1a74cd'))
          })
        )
    )
  if (entry.status === 'pending' || entry.status === 'known-not-written')
    menu.addItem((item) =>
      item
        .setTitle(t('streamB.retryBindingOnly.c54a8a'))
        .setIcon('rotate-cw')
        .onClick(() =>
          run(async () => {
            const result = await new ChatSelectionBindings(props.session).retry(key(entry))
            new Notice(
              result.status === 'applied'
                ? t('streamB.cardLinked.e1d170')
                : (result.reason ?? result.status),
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
