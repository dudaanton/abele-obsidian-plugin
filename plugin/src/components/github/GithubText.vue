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
import { retryImageThroughApi, type RepoFile } from '@/github/markdownLinks'
import type { GithubClient } from '@/github/client'
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
    /** For a picture the raw address refuses — a private repository's — read again with the token. */
    client?: GithubClient
  }>(),
  { asDocument: false, client: undefined }
)

const target = ref<HTMLElement>()
let component: Component | null = null
/** Which render is the current one: a later text must not be overwritten by an earlier render. */
let generation = 0
const approvedImages = new Set<string>()
/** Pictures read through the API, let go of with the text. */
const objectUrls: string[] = []

const render = async () => {
  if (!target.value || !component) return
  const mine = ++generation
  const next = createDiv()
  await renderGithubMarkdown(next, props.text, props.repo, component, approvedImages)
  if (mine !== generation || !target.value) return
  for (const img of Array.from(next.querySelectorAll('img')))
    retryImageThroughApi(img, props.client, props.repo, (url) => objectUrls.push(url))
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
  for (const url of objectUrls.splice(0)) URL.revokeObjectURL(url)
})
</script>

<style lang="scss">
.abele-github-text {
  white-space-collapse: collapse;
}

// Obsidian supplies the reading-view styling, but these renderers are outside its
// preview sizer. Bound their intrinsic widths here rather than clipping the whole tab.
.abele-github-text,
.abele-github-md {
  min-width: 0;
  overflow-wrap: anywhere;

  .table-wrapper {
    max-width: 100%;
    // A reading-view table keeps its columns and scrolls inside the document.
    overflow-x: auto;
  }

  table {
    overflow-wrap: normal;
    display: block;
    max-width: 100%;
    // A renderer without Obsidian's table wrapper needs the same local scroller.
    overflow-x: auto;
  }

  pre {
    max-width: 100%;
    white-space: pre;
    // Code keeps its source lines; only the code box, never the tab, scrolls sideways.
    overflow-x: auto;
  }

  pre code {
    white-space: pre;
    overflow-wrap: normal;
    word-break: normal;
  }

  :not(pre) > code {
    white-space: normal;
    overflow-wrap: anywhere;
  }

  img {
    max-width: 100%;
    height: auto;
  }
}
</style>
