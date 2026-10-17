<template>
  <!-- The end of a list that has more: it asks for the next part as it scrolls into view, so
       there is no button to press. While the part comes, a quiet line says so. -->
  <div
    ref="el"
    class="abele-scroll-more"
    role="status"
    :aria-busy="loading || undefined"
    :aria-label="loading ? t('kit.loading') : label"
  >
    <span v-if="loading" class="abele-scroll-more__text">{{ t('kit.loading') }}</span>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    /** The next part is on its way: the line says so and nothing more is asked. */
    loading?: boolean
    /** What the end stands for, for a screen reader: "More icons below". */
    label?: string
    /**
     * Anything that changes once a part has been added, the count shown for one. An observer
     * only speaks when the end crosses into view, so an end still in view after a short part
     * would never ask again; a change here looks once more.
     */
    shown?: number
  }>(),
  { loading: false, label: () => t('kit.moreBelow'), shown: 0 }
)
const emit = defineEmits<{ more: [] }>()

const el = ref<HTMLElement>()
let observer: IntersectionObserver | null = null
let inView = false

const ask = () => {
  if (inView && !props.loading) emit('more')
}

watch(
  el,
  (node) => {
    observer?.disconnect()
    observer = null
    const Observer = node?.ownerDocument.defaultView?.IntersectionObserver
    if (!node || !Observer) return
    // A little ahead of the end, so the next part is usually there before it is reached.
    observer = new Observer(
      (entries) => {
        inView = entries.some((e) => e.isIntersecting)
        ask()
      },
      { rootMargin: '0px 0px 200px 0px' }
    )
    observer.observe(node)
  },
  { flush: 'post' }
)

watch(
  () => [props.shown, props.loading],
  () => void nextTick(ask)
)

onBeforeUnmount(() => observer?.disconnect())
</script>

<style lang="scss">
.abele-scroll-more {
  display: flex;
  justify-content: center;
  min-height: var(--size-4-1);
}
.abele-scroll-more__text {
  padding: var(--size-4-2) 0;
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}
</style>
