<template>
  <!-- What an agent's send would put on the wire, before the person allows it: the environment,
       the method and address, the headers and the body, keys and secrets still by name. -->
  <div class="abele-http-send-preview">
    <div class="abele-http-send-preview__meta">
      <span>{{ request?.environment ?? '' }}</span>
      <span v-if="into" class="abele-http-send-preview__into">{{
        t('streamC.db5e9daaffaede66')
      }}</span>
    </div>
    <pre
      class="abele-tool-approval__code abele-selectable"
    ><code>{{ request?.text ?? error ?? t('streamC.3fad9129de986e6b') }}</code></pre>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

import { ref, watch } from 'vue'

const props = defineProps<{
  params: Record<string, unknown>
  /** Reads the request as it would go; the card stays plain where nothing can be read. */
  read: (
    id: string,
    environment?: string
  ) => Promise<{ environment: string; text: string } | undefined>
}>()

const request = ref<{ environment: string; text: string }>()
const error = ref<string>()
const into = ref(false)

watch(
  () => JSON.stringify(props.params),
  () => {
    const id = typeof props.params.id === 'string' ? props.params.id : ''
    const env = typeof props.params.environment === 'string' ? props.params.environment : undefined
    into.value = props.params.into_recording === true
    request.value = undefined
    error.value = undefined
    void props
      .read(id, env)
      .then((r) => {
        request.value = r
        if (!r) error.value = t('streamC.e55d37bc11fb1072', { v1: String(id) })
      })
      .catch(
        (e: unknown) =>
          (error.value = e instanceof Error ? e.message : t('streamC.9742efc95918fd55'))
      )
  },
  { immediate: true }
)
</script>

<style lang="scss">
.abele-http-send-preview__meta {
  display: flex;
  gap: var(--size-4-2);
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
}
.abele-http-send-preview__into {
  color: var(--color-red);
}
</style>
