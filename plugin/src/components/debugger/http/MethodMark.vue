<template>
  <!-- The method as a code before the name, in the colour every HTTP client gives it; the words
       are in its tooltip. -->
  <span
    ref="el"
    class="abele-http-method"
    :class="`abele-http-method_${method.toLowerCase()}`"
    role="img"
    :aria-label="method"
    >{{ short }}</span
  >
</template>

<script setup lang="ts">
import { t } from '@/i18n'

import { computed, onMounted, ref, watch } from 'vue'
import { setTooltip } from 'obsidian'
import type { HttpMethod } from './types'

const props = defineProps<{ method: HttpMethod }>()
const el = ref<HTMLElement>()
// As Bruno and Postman shorten them, so a column of names keeps one left edge.
const short = computed(() =>
  props.method === 'DELETE' ? 'DEL' : props.method === 'OPTIONS' ? 'OPT' : props.method
)
const words: Record<HttpMethod, string> = {
  GET: t('streamC.6d521636d1367835'),
  POST: t('streamC.f553e9e68004ee90'),
  PUT: t('streamC.cc1ddeac68a0961d'),
  PATCH: t('streamC.0daefe7dd4ed7f95'),
  DELETE: t('streamC.92dd38ce684c1863'),
  HEAD: t('streamC.fbf15d2070b5a136'),
  OPTIONS: t('streamC.e1a98cfef99e4922'),
}
const tip = () => el.value && setTooltip(el.value, words[props.method])
onMounted(tip)
watch(() => props.method, tip)
</script>

<style lang="scss">
.abele-http-method {
  display: inline-block;
  flex: 0 0 auto;
  // The longest, PATCH, and a space after it.
  min-width: 6ch;
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  font-weight: var(--font-semibold);
  line-height: var(--line-height-tight);
  color: var(--text-muted);
}
.abele-http-method_get {
  color: var(--color-green);
}
.abele-http-method_post {
  color: var(--color-yellow);
}
.abele-http-method_put {
  color: var(--color-blue);
}
.abele-http-method_patch {
  color: var(--color-purple);
}
.abele-http-method_delete {
  color: var(--color-red);
}
</style>
