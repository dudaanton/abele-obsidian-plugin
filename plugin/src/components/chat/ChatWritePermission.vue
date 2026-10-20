<template>
  <Button
    v-if="session.permissionMode?.value && session.permissionMode.value !== 'confirm-all'"
    class="abele-chat-write-permission"
    :text="t('streamB.writesWithoutAsking')"
    icon="pencil-line"
    @click="session.permissionMode.value = 'confirm-all'"
  />
</template>
<script setup lang="ts">
import type { Ref } from 'vue'
import { t } from '@/i18n'
import Button from '../obsidian/Button.vue'
defineProps<{ session: { permissionMode: Ref<string> } }>()
</script>
