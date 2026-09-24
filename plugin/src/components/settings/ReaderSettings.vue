<template>
  <div class="abele-settings__reader">
    <Section
      desc="EPUB books in the vault open in a reader tab of their own. These choices apply to every book, and can also be changed from a book's tab."
    >
      <ReaderSettingsForm />
    </Section>
  </div>
</template>

<script setup lang="ts">
import Section from '../obsidian/Section.vue'
import ReaderSettingsForm from '../reader/ReaderSettingsForm.vue'
</script>
