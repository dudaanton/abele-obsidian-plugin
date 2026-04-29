<template>
  <div class="abele-settings__other">
    <Setting
      name="CSS snippets folder"
      desc="Vault folder with .css files to auto-apply as style snippets. Leave empty to disable."
    >
      <Input
        :model-value="snippetsFolder"
        placeholder="e.g. snippets"
        @update:model-value="updateSnippetsFolder"
      />
    </Setting>
    <Setting name="Full-width sidebars" desc="Make sidebars take the full screen width on mobile.">
      <Checkbox :is-enabled="fullWidthSidebars" @toggle="toggleFullWidthSidebars" />
    </Setting>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { debounce } from 'obsidian'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { SnippetService } from '@/services/SnippetService'

const config = AbeleConfig.getInstance()
const snippetsFolder = ref(config.snippetsFolder)
const fullWidthSidebars = ref(config.fullWidthSidebars)

const applyClass = (enabled: boolean) => {
  document.body.classList.toggle('abele-full-width-sidebars', enabled)
}

// Apply on mount
applyClass(fullWidthSidebars.value)

const saveSnippetsFolder = debounce(async (value: string) => {
  config.snippetsFolder = value
  await config.saveSettings()
  await SnippetService.getInstance().reload()
}, 500)

const updateSnippetsFolder = (value: string) => {
  snippetsFolder.value = value
  saveSnippetsFolder(value)
}

const toggleFullWidthSidebars = async () => {
  fullWidthSidebars.value = !fullWidthSidebars.value
  config.fullWidthSidebars = fullWidthSidebars.value
  applyClass(fullWidthSidebars.value)
  await config.saveSettings()
}
</script>
