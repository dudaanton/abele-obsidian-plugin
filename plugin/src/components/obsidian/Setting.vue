<template>
  <div class="setting-item abele-obsidian-setting">
    <div class="setting-item-info">
      <div class="setting-item-name">{{ name }}</div>
      <div v-if="desc" class="setting-item-description">{{ desc }}</div>
    </div>
    <div class="setting-item-control">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  name: string
  desc?: string
}>()
</script>
