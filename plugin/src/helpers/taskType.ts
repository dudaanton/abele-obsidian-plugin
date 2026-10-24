/** Note types are exact frontmatter values, as in the typed note index. */
export function isTaskType(type: unknown): boolean {
  return type === 'task'
}
