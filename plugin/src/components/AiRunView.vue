<template>
  <div class="abele-run-view">
    <div class="abele-run-view__header">
      <div class="abele-run-view__title">
        <Icon icon="bot" no-hover />
        <span class="abele-run-view__agent">{{ run.agentName }}</span>
        <Badge class="abele-run-view__badge" text="read-only" />
      </div>

      <div class="abele-run-view__task">{{ run.task }}</div>

      <Icon
        v-if="run.parentChat"
        class="abele-run-view__parent"
        icon="corner-up-left"
        :tooltip="run.parentChat"
        text-right="Back to the chat that started this"
        @click="openParent"
      />
    </div>

    <div class="abele-run-view__body">
      <AiRunBranch
        v-for="(branch, idx) in run.branches"
        :key="idx"
        :branch="branch"
        :show-item="run.branches.length > 1"
      />
      <EmptyState v-if="!run.branches.length" text="This run recorded nothing." />
    </div>
  </div>
</template>

<script setup lang="ts">
import { TFile } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import Badge from './obsidian/Badge.vue'
import EmptyState from './obsidian/EmptyState.vue'
import AiRunBranch from './AiRunBranch.vue'
import { ChatService } from '@/ai/ChatService'
import { GlobalStore } from '@/stores/GlobalStore'
import type { RunFile } from '@/ai/RunStorage'

/**
 * A delegated run, shown as a conversation you can read but not join.
 *
 * There is no input box on purpose: this conversation belongs to an agent that another agent
 * dispatched, and a reply typed here would have nowhere to go.
 */
const props = defineProps<{ run: RunFile }>()

async function openParent(): Promise<void> {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(props.run.parentChat)
  if (file instanceof TFile) await ChatService.getInstance().openChatFile(file)
}
</script>

<style lang="scss">
.abele-run-view {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 auto;
}

.abele-run-view__header {
  padding: var(--size-4-2) var(--size-4-3);
  border-bottom: 1px solid var(--background-modifier-border);
}

.abele-run-view__title {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  flex-wrap: wrap;
}

.abele-run-view__agent {
  font-weight: var(--font-medium);
}

.abele-run-view__badge {
  font-size: var(--font-smallest);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0 var(--size-2-2);
  border-radius: var(--radius-s);
  background: var(--background-modifier-border);
  color: var(--text-muted);
}

.abele-run-view__task {
  margin-top: var(--size-2-2);
  color: var(--text-muted);
  font-size: var(--font-small);
  overflow-wrap: anywhere;
}

.abele-run-view__parent {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  margin-top: var(--size-4-1);
  padding: 0;
  background: transparent;
  border: none;
  box-shadow: none;
  color: var(--text-accent);
  cursor: pointer;
  font-size: var(--font-smallest);
}

.abele-run-view__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: var(--size-4-2) var(--size-4-3);
}
</style>
