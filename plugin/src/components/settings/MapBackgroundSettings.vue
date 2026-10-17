<template>
  <MapBackgrounds
    :backgrounds="backgrounds"
    :from-maps="importable.length"
    @add="edit()"
    @edit="edit"
    @remove="remove"
    @reorder="save"
    @import="copyUpstream"
  />
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Notice } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { openComponentDialog } from '@/modal/componentDialog'
import { t } from '@/i18n'
import type { Background } from '@/maps/core/model'
import MapBackgrounds from './MapBackgrounds.vue'
import MapBackgroundEditor from './MapBackgroundEditor.vue'

const config = AbeleConfig.getInstance()
const backgrounds = computed(() => {
  void config.version.value
  return config.mapBackgrounds ?? []
})
const importable = ref<Background[]>([])
onMounted(async () => {
  const vault = GlobalStore.getInstance().app.vault
  const path = `${vault.configDir}/plugins/maps/data.json`
  try {
    if (!(await vault.adapter.exists(path))) return
    const data = JSON.parse(await vault.adapter.read(path)) as { tileSets?: unknown }
    if (!Array.isArray(data.tileSets)) return
    importable.value = data.tileSets.flatMap((v: Record<string, unknown>) =>
      typeof v.id === 'string' &&
      typeof v.name === 'string' &&
      typeof v.lightTiles === 'string' &&
      v.lightTiles.trim()
        ? [
            {
              id: v.id,
              name: v.name,
              light: [v.lightTiles],
              dark: typeof v.darkTiles === 'string' && v.darkTiles.trim() ? [v.darkTiles] : [],
            },
          ]
        : []
    )
  } catch {
    console.debug('[maps] Background import source unavailable')
  }
})
async function save(list: Background[]) {
  config.mapBackgrounds = list
  try {
    await config.saveSettings()
  } catch {
    new Notice(t('maps.saveFailed'))
  }
}
function edit(background?: Background) {
  const dialog = openComponentDialog(
    () => MapBackgroundEditor,
    {
      background,
      onSave: (value: Background) => {
        dialog.close()
        void save(
          background
            ? backgrounds.value.map((b) => (b.id === background.id ? value : b))
            : [...backgrounds.value, value]
        )
      },
    },
    { document: GlobalStore.getInstance().settingsContainer.value?.ownerDocument }
  )
}
function remove(background: Background) {
  void save(backgrounds.value.filter((b) => b.id !== background.id))
}
function copyUpstream() {
  void save([
    ...backgrounds.value,
    ...importable.value.filter((b) => !backgrounds.value.some((existing) => existing.id === b.id)),
  ])
}
</script>
