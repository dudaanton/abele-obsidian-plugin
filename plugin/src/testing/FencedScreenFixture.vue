<template>
  <TokenUiFixture :screen="replacement" @close="emit('close')" />
</template>
<script setup lang="ts">
import { computed } from 'vue'
import TokenUiFixture from './TokenUiFixture.vue'
import type { FencedScreen, FencedState } from './fencedScreens'
const props = defineProps<{ screen: FencedScreen; state: FencedState }>()
const emit = defineEmits<{ close: [] }>()
// Retained inspection names now open the token screen that replaces the retired access flow.
const replacement = computed(() =>
  props.screen === 'plugin-code' || props.screen === 'script-approval'
    ? 'review'
    : props.screen === 'initial-batch'
      ? 'attachment'
      : props.screen === 'personal-join' || props.screen === 'invitation'
        ? 'connect'
        : props.screen === 'unshare'
          ? 'disconnect'
          : 'share'
)
</script>
