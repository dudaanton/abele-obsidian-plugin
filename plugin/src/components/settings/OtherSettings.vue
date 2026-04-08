<template>
  <div class="abele-settings__other">
    <Setting name="Full-width sidebars" desc="Make sidebars take the full screen width on mobile.">
      <Checkbox :is-enabled="fullWidthSidebars" @toggle="toggleFullWidthSidebars" />
    </Setting>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Setting from '../obsidian/Setting.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import { AbeleConfig } from '@/services/AbeleConfig'

const config = AbeleConfig.getInstance()
const fullWidthSidebars = ref(config.fullWidthSidebars)

const applyClass = (enabled: boolean) => {
  document.body.classList.toggle('abele-full-width-sidebars', enabled)
}

// Apply on mount
applyClass(fullWidthSidebars.value)

const toggleFullWidthSidebars = async () => {
  fullWidthSidebars.value = !fullWidthSidebars.value
  config.fullWidthSidebars = fullWidthSidebars.value
  applyClass(fullWidthSidebars.value)
  await config.saveSettings()
}
</script>
