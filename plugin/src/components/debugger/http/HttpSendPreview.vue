<template>
  <!-- What an agent's send would put on the wire, before the person allows it: the environment,
       the method and address, the headers and the body, keys and secrets still by name. -->
  <div class="abele-http-send-preview">
    <div class="abele-http-send-preview__meta">
      <span>{{ request?.environment ?? '' }}</span>
      <span v-if="into" class="abele-http-send-preview__into">Into the recording</span>
    </div>
    <pre
      class="abele-tool-approval__code"
    ><code>{{ request?.text ?? error ?? 'Reading the request…' }}</code></pre>
  </div>
</template>

<script setup lang="ts">
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
        if (!r) error.value = `No saved request ${id}`
      })
      .catch((e: unknown) => (error.value = e instanceof Error ? e.message : 'Not readable'))
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
