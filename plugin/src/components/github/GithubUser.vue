<template>
  <span
    ref="el"
    class="abele-github-user"
    :class="{ 'abele-github-user_named': !!name }"
    :role="name ? 'button' : undefined"
    :tabindex="name ? 0 : undefined"
    @click="flip"
    @keydown.enter.prevent="flip"
  >
    <Avatar :src="person.avatar" :name="label" />
    <span class="abele-github-user__label">{{ label }}</span>
  </span>
</template>

<script setup lang="ts">
/**
 * A person in a GitHub tab: their picture and their name, or their login — whichever the
 * settings say. The other one is never out of reach: it is in the tooltip, and a click or a tap
 * on the person swaps the two in place, which is how a phone, with no hover, gets to it.
 *
 * The name comes from the profile, looked up the first time the login is shown and kept for a
 * week (see `users.ts`). Until then, and for a profile with no name, the login is what shows.
 */
import { computed, inject, onMounted, ref, watch } from 'vue'
import { setTooltip } from 'obsidian'
import Avatar from '../obsidian/Avatar.vue'
import { GITHUB_PEOPLE, githubUsers } from '@/github/users'
import { githubSettings } from '@/github/GithubService'
import { AbeleConfig } from '@/services/AbeleConfig'

const props = defineProps<{
  login: string
  /** The picture the API answer named, drawn until one is kept. */
  avatar?: string
}>()

const client = inject(GITHUB_PEOPLE, null)
const host = computed(() => client?.()?.endpoints.webHost ?? 'github.com')

const person = computed(() => githubUsers().person(host.value, props.login, props.avatar))
const name = computed(() => {
  const n = person.value.name
  return n && n !== props.login ? n : null
})

const config = AbeleConfig.getInstance()
const byName = computed(() => {
  void config.version.value
  return githubSettings().userDisplay !== 'login'
})

/** Swapped by a click, for this one place only. */
const swapped = ref(false)
const label = computed(() =>
  name.value && byName.value !== swapped.value ? name.value : props.login
)

const flip = (e: Event) => {
  if (!name.value) return
  // The name is text to copy: the click that ends a drag over it is not a click on it.
  const selection = el.value?.ownerDocument.getSelection()
  if (selection && !selection.isCollapsed && el.value?.contains(selection.anchorNode)) return
  // Inside a card that opens on a click — a commit — the click is the person's, not the card's.
  e.stopPropagation()
  swapped.value = !swapped.value
}

const el = ref<HTMLElement>()
const tooltip = computed(() => (name.value ? `${name.value} · ${props.login}` : ''))
watch(tooltip, (text) => el.value && setTooltip(el.value, text))

const ask = () => {
  const c = client?.()
  if (c && props.login) githubUsers().want(c, props.login, props.avatar)
}
onMounted(() => {
  if (el.value && tooltip.value) setTooltip(el.value, tooltip.value)
  ask()
})
watch(() => props.login, ask)
</script>

<style lang="scss">
.abele-github-user {
  display: inline-flex;
  align-items: center;
  gap: var(--size-4-1);
  max-width: 100%;
  vertical-align: middle;

  &_named {
    cursor: pointer;
  }

  &__label {
    overflow-wrap: anywhere;
  }
}
</style>
