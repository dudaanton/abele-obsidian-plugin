/** Explicit file references typed with @ in a chat message. */
export function fileMentions(content: string): string[] {
  const references = content.matchAll(/(?:^|[\s([{])@([\p{L}\p{N}_/. -]+\.[\p{L}\p{N}_]+)/gu)
  return [...references].map((match) => match[1])
}
