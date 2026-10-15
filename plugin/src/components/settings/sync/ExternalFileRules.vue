<template>
  <Setting
    name="Keep only on the server"
    desc="Device-local rule. It runs only when you preview and confirm; pinned, changed and open files stay here."
  />
  <Setting name="Offload folder" desc="Empty means all folders.">
    <Input v-model="folder" placeholder="All folders" />
  </Setting>
  <Setting name="File types" desc="Comma-separated extensions. Empty means all attachment types.">
    <Input v-model="extensions" placeholder="pdf, epub, jpg" />
  </Setting>
  <Setting name="Minimum size (MiB)">
    <Input v-model="minSize" placeholder="0" />
  </Setting>
  <Setting
    name="Not opened for days"
    desc="0 ignores age. Files without a recorded opening are excluded when age is set."
  >
    <Input v-model="days" placeholder="0" />
  </Setting>
  <Setting
    name="Review matching files"
    :desc="error || 'See every file and the estimated space before making changes.'"
  >
    <Button
      text="Preview"
      tooltip="List matching files and review space before offloading"
      :disabled="busy"
      @click="preview"
    />
  </Setting>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { Notice } from 'obsidian'
import Setting from '../../obsidian/Setting.vue'
import Input from '../../obsidian/Input.vue'
import Button from '../../obsidian/Button.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { TokenSettingsPort } from '@/sync/tokenSettingsPort'
import { readRule, saveRule, previewRule } from '@/sync/external/rules'
import { confirmOffload, externalStatus } from '@/sync/external/registerActions'

const app = GlobalStore.getInstance().app
const id = TokenSettingsPort.getInstance().connectionId
const saved = readRule(app, id)
const folder = ref(saved.folder)
const extensions = ref(saved.extensions.join(', '))
const minSize = ref(String(saved.minBytes / 1024 / 1024))
const days = ref(String(saved.unopenedDays))
const error = ref('')
const busy = ref(false)
async function preview() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const rule = {
      folder: folder.value.trim(),
      extensions: extensions.value
        .split(',')
        .map((item) => item.trim().replace(/^\./, '').toLowerCase())
        .filter(Boolean),
      minBytes: Number(minSize.value) * 1024 * 1024,
      unopenedDays: Number(days.value),
    }
    const result = await previewRule(app, id, rule)
    if (!(await confirmOffload({ app }, result.preview))) return
    saveRule(app, id, rule)
    const results = await result.actions.apply(result.preview)
    new Notice(results.map((file) => `${file.path}: ${externalStatus(file.status)}`).join('\n'))
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure)
    console.debug('[abele-sync] external file rule did not finish', failure)
  } finally {
    busy.value = false
  }
}
</script>
