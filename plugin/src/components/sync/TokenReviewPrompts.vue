<template>
  <template v-if="ui">
    <TokenConnectionPrompts
      v-for="row in ui.rows.value"
      :key="row.id"
      :ui="ui"
      :connection-id="row.id"
    />
  </template>
  <TokenDialogs
    v-if="ui && question"
    :key="question.id"
    :ui="ui"
    mode="attachment"
    :question="question"
    @close="later"
  />
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import TokenDialogs from './TokenDialogs.vue'
import TokenConnectionPrompts from './TokenConnectionPrompts.vue'
import { tokenUi } from '@/sync/tokenUi'
const ui = tokenUi
const deferred = ref(new Set<string>())
const question = computed(() =>
  ui.value?.questions.value.find((one) => !deferred.value.has(one.id))
)
function later() {
  if (question.value) deferred.value.add(question.value.id)
}
watch(
  () => ui.value?.questions.value,
  () => {
    const pending = new Set(ui.value?.questions.value.map((one) => one.id))
    deferred.value = new Set([...deferred.value].filter((id) => pending.has(id)))
  }
)
</script>
