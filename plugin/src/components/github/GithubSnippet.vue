<template>
  <Card v-if="snippet" class="abele-github-snippet" :title="snippet.label" :href="snippet.url">
    <GithubText
      v-if="snippet.kind === 'comment'"
      class="abele-github-snippet__quote"
      :text="snippet.text"
      :repo="snippetRepo"
      as-document
    />
    <div v-else ref="codeEl" class="abele-github-code abele-github-snippet__code" />
  </Card>
  <div v-else class="abele-github-snippet abele-github-snippet_unread">
    <div class="abele-github-snippet__note">
      This GitHub snippet has no address or label any more, so it is shown as written.
    </div>
    <pre class="abele-github-snippet__raw"><code>{{ source }}</code></pre>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Card from '../obsidian/Card.vue'
import GithubText from './GithubText.vue'
import { repoOfUrl } from '@/github/safeMarkdown'
import { NO_REPO } from '@/github/repoContext'
import { mountSnippet, type Viewer } from '@/github/codeViewer'
import type { SnippetBlock } from '@/github/snippetBlock'

const props = withDefaults(
  defineProps<{
    /** Null for a block that no longer reads as a snippet; `source` is then shown as it is. */
    snippet: SnippetBlock | null
    source: string
    filePath?: string
  }>(),
  { filePath: '' }
)

const codeEl = ref<HTMLElement>()
const snippetRepo = computed(() => {
  const source = props.snippet?.source
  if (!source) return props.snippet ? (repoOfUrl(props.snippet.url) ?? NO_REPO) : NO_REPO
  const [owner, repo] = source.repository.split('/')
  return {
    provider: source.deployment.kind === 'gitea' ? ('gitea' as const) : ('forgejo' as const),
    origin: source.deployment.webBase,
    host: new URL(source.deployment.webBase).hostname,
    owner,
    repo,
    ref: 'HEAD',
    path: '',
  }
})
let viewer: Viewer | null = null

onMounted(() => {
  const s = props.snippet
  if (!s || s.kind === 'comment' || !codeEl.value) return
  viewer = mountSnippet(codeEl.value, { ...s, kind: s.kind })
})

onBeforeUnmount(() => {
  viewer?.destroy()
  viewer = null
})
</script>

<style lang="scss">
.abele-github-snippet {
  margin-block: var(--size-4-2);

  // Where it came from, as a quiet line over the code; the code is what is read.
  .abele-card__name {
    font-size: var(--font-ui-small);
    overflow-wrap: anywhere;
  }

  // Inside the card the code is a note's code block, its background and no second frame.
  &__code {
    background-color: var(--abele-code-background);
    border-radius: var(--radius-s);
    overflow: hidden;
    font-size: var(--code-size);

    // A long snippet scrolls within the card rather than making the note that long, and a long
    // line scrolls sideways within the code, as a code block in a note does.
    .cm-scroller {
      max-height: calc(var(--code-size) * 30);
      overflow: auto;
    }
  }

  &__quote {
    border-left: var(--size-2-1) solid var(--background-modifier-border);
    padding-left: var(--size-4-3);
    overflow-wrap: anywhere;
  }

  &__note {
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }

  &__raw {
    // Written by hand into something unreadable: shown as the note's own code block would be.
    overflow-x: auto;
  }
}
</style>
