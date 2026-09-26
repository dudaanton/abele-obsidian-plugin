<template>
  <div class="abele-settings__reader">
    <Section
      desc="EPUB books in the vault open in a reader tab of their own, and PDFs can too. These choices apply to every book, and can also be changed from a book's tab with the Aa button."
    >
      <ReaderSettingsForm />
    </Section>
    <BookNotesSettings />
    <BookScriptsSettings />
  </div>
</template>

<script setup lang="ts">
import Section from '../obsidian/Section.vue'
import ReaderSettingsForm from '../reader/ReaderSettingsForm.vue'
import BookNotesSettings from '../reader/BookNotesSettings.vue'
import BookScriptsSettings from '../reader/BookScriptsSettings.vue'
</script>
