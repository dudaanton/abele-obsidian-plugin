<template>
  <div ref="root" class="abele-github-md markdown-rendered" @click="onClick">
    <template v-for="(b, i) in blocks" :key="`${generation}:${i}`">
      <div
        class="abele-github-md__block"
        :class="{
          'abele-github-md__block_marked': marked.has(i),
          'abele-github-md__block_list': b.kind === 'list-item',
          'abele-github-md__block_empty': b.kind === 'definitions',
        }"
        :data-start="b.start"
        :data-end="b.end"
        :data-anchor="b.slug"
      >
        <Icon
          v-if="b.kind !== 'definitions'"
          class="abele-github-md__handle"
          icon="link"
          :tooltip="`Select ${linesLabel({ from: b.start, to: b.end }).toLowerCase()} — Shift-click to extend`"
          @click="pick(i, $event)"
        />
        <div :ref="(el) => setContent(i, el)" class="abele-github-md__content" />
      </div>
      <div v-if="barAfter === i" class="abele-github-md__bar">
        <slot name="bar" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Component, MarkdownRenderer, Platform } from 'obsidian'
import Icon from '../obsidian/Icon.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import type { GithubClient } from '@/github/client'
import type { LineSpan } from '@/github/permalinks'
import type { LineRange } from '@/github/urls'
import { splitMarkdown } from '@/github/markdownBlocks'
import {
  blockAt,
  blockSource,
  blocksOverlapping,
  finishFootnotes,
  footnoteRefs,
  linesLabel,
  pickBlock,
  sourcesOf,
} from '@/github/markdownPreview'
import { repoImageUrl, type RepoFile } from '@/github/markdownLinks'
import { finishGithubMarkdown, guardInlineCode } from '@/github/safeMarkdown'
import { LINE_CONTEXT, elementTop, pinIntoView, scrollParent } from '@/github/scrollTo'

/**
 * A markdown file from GitHub, rendered block by block so that every block knows the source
 * lines it came from. A block's handle selects its lines — the same selection, and the same bar,
 * as a click on a line number in the code view — and the lines a link or a selection covers mark
 * the blocks they touch.
 */
const props = withDefaults(
  defineProps<{
    text: string
    file: RepoFile
    /** The lines the link named. */
    range?: LineRange
    selected?: LineSpan | null
    /** A line to bring into view when drawn: the block holding it goes to the top. */
    focus?: { line: number; context: number } | null
    /** For an image the raw address refuses, read again through the API with the token. */
    client?: GithubClient
  }>(),
  { range: undefined, selected: null, focus: null, client: undefined }
)

const emit = defineEmits<{
  (e: 'select', span: LineSpan | null): void
  /** A file of the repository a link pointed at, to open in the tab. */
  (e: 'open', url: string): void
  /** Every block has been rendered. */
  (e: 'rendered'): void
}>()

const root = ref<HTMLElement>()
const blocks = computed(() => splitMarkdown(props.text))
const sources = computed(() => sourcesOf(props.text, blocks.value))
/** Moves with every new text, so the blocks are drawn afresh rather than reused. */
const generation = ref(0)

const shown = computed<LineSpan | null>(
  () => props.selected ?? (props.range ? { from: props.range.start, to: props.range.end } : null)
)
const marked = computed(() => new Set(blocksOverlapping(blocks.value, shown.value)))
/** The bar goes under the last block the selection reaches. */
const barAfter = computed(() => {
  const s = props.selected
  if (!s) return -1
  let last = -1
  blocks.value.forEach((b, i) => {
    if (b.start <= s.to) last = i
  })
  return last
})

/** Where a Shift-click extends from: the block picked last, or the one the selection starts in. */
let anchor: number | null = null
const pick = (index: number, event: MouseEvent) => {
  const current = {
    selected: props.selected,
    anchor: anchor ?? (props.selected ? blockAt(blocks.value, props.selected.from) : null),
  }
  // A phone has no Shift: there a tap extends the selection, and a tap inside it clears it.
  const next = pickBlock(blocks.value, current, index, event.shiftKey, Platform.isPhone)
  anchor = next.anchor
  emit('select', next.selected)
}

const contents: HTMLElement[] = []
const setContent = (i: number, el: unknown) => {
  if (el instanceof HTMLElement) contents[i] = el
}

let component: Component | null = null
let renderRun = 0
const objectUrls: string[] = []

/** An image the raw address refused: once more through the API, when there is a token. */
const retryThroughApi = (img: HTMLImageElement) => {
  const path = img.dataset.abeleRepoPath
  const client = props.client
  if (!path || !client?.hasToken) return
  img.addEventListener(
    'error',
    () => {
      repoImageUrl(client, props.file, path).then(
        (url) => {
          objectUrls.push(url)
          img.src = url
        },
        () => {}
      )
    },
    { once: true }
  )
}

const renderAll = async () => {
  const mine = ++renderRun
  component?.unload()
  component = new Component()
  component.load()
  await nextTick()
  const app = GlobalStore.getInstance().app
  const list = blocks.value
  for (let i = 0; i < list.length; i++) {
    const el = contents[i]
    const source = blockSource(list[i], sources.value)
    if (!el || !source) continue
    const next = createDiv()
    try {
      await MarkdownRenderer.render(app, guardInlineCode(source), next, '', component)
    } catch (e) {
      // One block that will not render is shown as its text; the rest of the file still is.
      console.debug('Abele: a markdown block did not render', e)
      next.replaceChildren(createEl('pre', { text: source }))
    }
    if (mine !== renderRun) return
    finishGithubMarkdown(next, props.file)
    finishFootnotes(next, list[i], sources.value)
    for (const img of Array.from(next.querySelectorAll('img'))) retryThroughApi(img)
    el.replaceChildren(...Array.from(next.childNodes))
  }
  emit('rendered')
}

const blockEl = (i: number) =>
  root.value?.querySelectorAll<HTMLElement>('.abele-github-md__block')[i] ?? null

let unpin = () => {}
const scrollToBlock = (index: number, context = LINE_CONTEXT.context ?? 0) => {
  if (!root.value || index < 0) return
  unpin()
  unpin = pinIntoView(
    root.value,
    elementTop(() => blockEl(index)),
    { context }
  )
}

const onClick = (event: MouseEvent) => {
  const a = (event.target as Element | null)?.closest?.('a')
  if (!a || !root.value?.contains(a)) return
  const data = (a as HTMLElement).dataset
  if (data.abeleAnchor !== undefined) {
    event.preventDefault()
    scrollToBlock(
      blocks.value.findIndex((b) => b.slug === data.abeleAnchor),
      0
    )
  } else if (data.abeleFootnote) {
    event.preventDefault()
    scrollToBlock(blocks.value.findIndex((b) => b.footnote === data.abeleFootnote))
  } else if (data.abeleFootnoteBack) {
    event.preventDefault()
    const label = data.abeleFootnoteBack
    const lines = sources.value.lines
    scrollToBlock(
      blocks.value.findIndex(
        (b) =>
          b.kind !== 'footnote' &&
          footnoteRefs(lines.slice(b.start - 1, b.end).join('\n')).includes(label)
      )
    )
  } else if (data.abeleBlocked !== undefined || a.classList.contains('footnote-link')) {
    event.preventDefault()
  } else if (data.abeleRepo !== undefined) {
    // Reached only when the GitHub link handler is off: it takes these clicks first otherwise.
    event.preventDefault()
    emit('open', a.getAttribute('href') ?? '')
  }
}

const draw = async () => {
  generation.value++
  anchor = null
  contents.length = 0
  await renderAll()
}

onMounted(async () => {
  const focus = props.focus
  const target = focus?.line ?? props.range?.start
  const drawn = renderAll()
  if (target !== undefined) scrollToBlock(blockAt(blocks.value, target), focus?.context)
  await drawn
})

watch(
  () => props.text,
  (): void => void draw()
)
// A link to the same lines again brings them back into view.
watch(
  () => props.range,
  (range) => {
    if (range) scrollToBlock(blockAt(blocks.value, range.start))
  }
)

onBeforeUnmount(() => {
  renderRun++
  unpin()
  component?.unload()
  component = null
  for (const url of objectUrls) URL.revokeObjectURL(url)
})

/** The blocks' boxes against the tab's scrolling box. */
const box = () => (root.value ? scrollParent(root.value)?.getBoundingClientRect() : undefined)

defineExpose({
  /** The first line of the block at the top of the tab, for the code view to open at. */
  topLine(): number | null {
    const rect = box()
    if (!rect) return null
    const els: ArrayLike<HTMLElement> =
      root.value?.querySelectorAll<HTMLElement>('.abele-github-md__block') ?? []
    for (let i = 0; i < els.length; i++) {
      if (els[i].getBoundingClientRect().bottom > rect.top) return blocks.value[i]?.start ?? null
    }
    return null
  },
  shows(span: LineSpan): boolean {
    const rect = box()
    if (!rect) return false
    return blocksOverlapping(blocks.value, span).some((i) => {
      const r = blockEl(i)?.getBoundingClientRect()
      return !!r && r.top < rect.bottom && r.bottom > rect.top
    })
  },
})
</script>

<style lang="scss">
.abele-github-md {
  width: 100%;
  max-width: calc(var(--file-line-width) + var(--size-4-8));
  margin-inline: auto;

  &__block {
    position: relative;
    // Room at the left for the handle, which is where a finger finds it on a phone.
    padding-inline-start: var(--size-4-8);
    border-radius: var(--radius-s);
  }

  &__block_empty {
    display: none;
  }

  &__handle {
    position: absolute;
    inset-inline-start: 0;
    top: 0;
    opacity: 0;
    --icon-size: var(--icon-xs);
  }

  &__block:hover > &__handle,
  &__block_marked > &__handle,
  &__handle:focus-visible {
    opacity: 1;
  }

  &__block_marked {
    box-shadow: inset var(--size-4-1) 0 0 var(--interactive-accent);
    background: color-mix(in srgb, var(--color-yellow) 20%, transparent);
  }

  // A list's items are rendered apart; together they read as one list.
  &__block_list:has(+ &__block_list) &__content :is(ul, ol) {
    margin-block-end: 0;
  }

  &__block_list + &__block_list &__content :is(ul, ol) {
    margin-block-start: 0;
  }

  &__bar {
    margin-block: var(--size-4-2);
    border-radius: var(--radius-s);
    overflow: hidden;
  }
}

// No hover on a touch screen: the handles stay in sight, quietly.
body.is-mobile .abele-github-md__handle {
  opacity: 0.5;
}
</style>
