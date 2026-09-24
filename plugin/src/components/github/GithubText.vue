<template>
  <div
    ref="target"
    class="abele-markdown abele-github-text"
    :class="{ 'markdown-rendered': asDocument }"
    @click="onClick"
  ></div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { Component } from 'obsidian'
import type { RepoFile } from '@/github/markdownLinks'
import { githubMarkdownClick, renderGithubMarkdown } from '@/github/safeMarkdown'

/**
 * Text written on GitHub — a comment, a description, a commit message, a quoted comment —
 * rendered the way every piece of GitHub text in the plugin is: see `safeMarkdown.ts`. The kit's
 * `Markdown` would hand it to the vault's own link handling and to every plugin as it stands.
 */
const props = withDefaults(
  defineProps<{
    text: string
    /** The repository the text was written in: its relative links and images point there. */
    repo: RepoFile
    /** Reading-view styling, for a whole comment rather than a line of it. */
    asDocument?: boolean
  }>(),
  { asDocument: false }
)

const target = ref<HTMLElement>()
let component: Component | null = null
/** Which render is the current one: a later text must not be overwritten by an earlier render. */
let generation = 0

const render = async () => {
  if (!target.value || !component) return
  const mine = ++generation
  const next = createDiv()
  await renderGithubMarkdown(next, props.text, props.repo, component)
  if (mine !== generation || !target.value) return
  target.value.replaceChildren(...Array.from(next.childNodes))
}

const onClick = (event: MouseEvent) => githubMarkdownClick(event, {})

onMounted(() => {
  component = new Component()
  component.load()
  void render()
})

watch(
  () => [props.text, props.repo],
  (): void => void render(),
  { deep: true }
)

onUnmounted(() => {
  generation++
  component?.unload()
  component = null
})
</script>

<style scoped>
.abele-github-text {
  white-space-collapse: collapse;
}
</style>
