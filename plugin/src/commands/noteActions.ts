/** Shared labels, command ids and Obsidian icons for every note menu. */
export const NOTE_ACTIONS = [
  { id: 'add-to-agent-context', title: 'Add to agent context', icon: 'bot' },
  { id: 'chat-about-current-note', title: 'Chat about this', icon: 'message-square-plus' },
  { id: 'attach-note-to-chat', title: 'Attach to a chat', icon: 'paperclip' },
  { id: 'attach-chat-to-current-note', title: 'Attach a chat to note', icon: 'link' },
  { id: 'copy-note-wikilink', title: 'Copy wikilink', icon: 'copy' },
] as const
