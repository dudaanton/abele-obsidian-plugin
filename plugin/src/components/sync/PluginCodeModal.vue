<template>
  <ObsidianModal title="Review plugin code from sync" phone-sheet @close="close">
    <div class="abele-plugin-code">
      <p class="abele-plugin-code__text">
        These plugins contain code that can run in Obsidian and access your vault. Installing them
        is separate from applying settings. Only install code from devices you trust.
      </p>
      <ul class="abele-plugin-code__list">
        <li v-for="plugin in plugins" :key="plugin.id">{{ plugin.label }}</li>
      </ul>
      <p class="abele-plugin-code__text">
        Nothing listed has been installed. Keep local code leaves this device's code unchanged; new
        plugins stay uninstalled. Later leaves this review on the Sync tab.
      </p>
      <p v-if="error" class="abele-plugin-code__error">{{ error }}</p>
      <div class="abele-plugin-code__actions">
        <Button
          text="Later"
          :disabled="busy"
          tooltip="Leave the code staged for review later"
          @click="close"
        />
        <Button
          text="Keep local code"
          :disabled="busy || readOnly"
          tooltip="Decline these changes and keep this device's plugin code"
          @click="keep"
        />
        <Button
          :text="reloadable ? 'Install and reload' : 'Install plugin code'"
          :accent="!readOnly"
          :disabled="busy || readOnly"
          tooltip="Install only the plugin code shown here; restart Obsidian if reload is unavailable"
          @click="install"
        />
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Notice } from 'obsidian'
import type { ChangeItem } from '@abele/sync-protocol'
import { SyncService } from '@/sync/SyncService'
import { appliedNotice, keptNotice } from '@/sync/stagedSettings'
import { codePluginIds } from '@/sync/stagedPluginCode'
import { reasonOf } from '@/sync/format'
import ObsidianModal from '../obsidian/Modal.vue'
import Button from '../obsidian/Button.vue'

const props = defineProps<{
  changes: ChangeItem[]
  names: Record<string, string>
  questionKey: number
  readOnly?: boolean
}>()
const emit = defineEmits<{ (e: 'close', questionKey: number): void }>()
const sync = SyncService.getInstance()
const busy = ref(false)
const error = ref<string | null>(null)
const reloadable = sync.codePrompt.reloader.available()
// A local edit can remove one plugin's changes while the remaining question stays open.
// This is already the code-only lane, so no own-folder exclusion is needed here.
const plugins = computed(() =>
  [...new Set(props.changes.flatMap((one) => codePluginIds(one, '')))].map((id) => ({
    id,
    label: props.names[id] ?? id,
  }))
)
const close = (): void => {
  if (!busy.value) emit('close', props.questionKey)
}
const versions = (): string[] => props.changes.map((one) => one.version_id)

async function run(work: () => Promise<string>): Promise<void> {
  if (busy.value || props.readOnly) return
  busy.value = true
  error.value = null
  try {
    // The staging outcomes and recovery instructions apply equally to settings and code.
    new Notice((await work()).replace(/settings/gi, 'plugin code'))
    emit('close', props.questionKey)
  } catch (failure) {
    error.value = `The operation could not finish: ${reasonOf(failure)}. Check the Sync tab before reloading.`
  } finally {
    busy.value = false
  }
}
const install = (): Promise<void> =>
  run(async () => appliedNotice(await sync.applyPluginCodeAndReload(versions())))
const keep = (): Promise<void> =>
  run(async () => keptNotice(await sync.keepLocalPluginCode(versions())))
</script>

<style lang="scss">
.abele-plugin-code {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
}
.abele-plugin-code__text,
.abele-plugin-code__list,
.abele-plugin-code__error {
  margin: 0;
  overflow-wrap: anywhere;
}
.abele-plugin-code__list {
  padding-inline-start: var(--size-4-5);
}
.abele-plugin-code__error {
  color: var(--text-error);
}
.abele-plugin-code__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--size-4-2);
}
</style>
