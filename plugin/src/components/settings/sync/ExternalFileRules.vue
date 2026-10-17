<template>
  <Setting
    :name="t('settings.sync.ExternalFileRules.keep_only_on_the_server.21caa8b7')"
    :desc="t('settings.sync.ExternalFileRules.device_local_rule_it_runs.cc40b724')"
  />
  <Setting
    :name="t('settings.sync.ExternalFileRules.offload_folder.6566fece')"
    :desc="t('settings.sync.ExternalFileRules.empty_means_all_folders.c907d956')"
  >
    <Input
      v-model="folder"
      :placeholder="t('settings.sync.ExternalFileRules.all_folders.226fd0e5')"
    />
  </Setting>
  <Setting
    :name="t('settings.sync.ExternalFileRules.file_types.696bc9a7')"
    :desc="t('settings.sync.ExternalFileRules.comma_separated_extensions_empty_means.6af4a62a')"
  >
    <Input
      v-model="extensions"
      :placeholder="t('settings.sync.ExternalFileRules.pdf_epub_jpg.aef4166d')"
    />
  </Setting>
  <Setting :name="t('settings.sync.ExternalFileRules.minimum_size_mib.f9c796bb')">
    <Input v-model="minSize" placeholder="0" />
  </Setting>
  <Setting
    :name="t('settings.sync.ExternalFileRules.not_opened_for_days.42eb5259')"
    :desc="t('settings.sync.ExternalFileRules.ignores_age_files_without_a.a2dd1ff0')"
  >
    <Input v-model="days" placeholder="0" />
  </Setting>
  <Setting
    :name="t('settings.sync.ExternalFileRules.review_matching_files.f7400143')"
    :desc="error || t('settings.sync.ExternalFileRules.see_every_file_and_the.b398409d')"
  >
    <Button
      :text="t('settings.sync.ExternalFileRules.preview.324b134f')"
      :tooltip="t('settings.sync.ExternalFileRules.list_matching_files_and_review.df3d52b2')"
      :disabled="busy"
      @click="preview"
    />
  </Setting>
</template>
<script setup lang="ts">
import { t } from '@/i18n'
import { settingsSyncText } from '@/i18n/settingsSync'
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
    new Notice(
      results
        .map((file) => `${file.path}: ${externalStatus(file.status, settingsSyncText)}`)
        .join('\n')
    )
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure)
    console.debug('[abele-sync] external file rule did not finish', failure)
  } finally {
    busy.value = false
  }
}
</script>
