export function syncFixtureRules(root: string, extra: string[] = []): string {
  // Core negations can include a file through an excluded parent. Never unignore the
  // whole configuration directory: that would exchange the installed build and data.json.
  return [
    '*',
    '!' + root + '/',
    '!' + root + '/**',
    '.obsidian/',
    ...extra.map((path) => '!' + path),
    '',
  ].join('\n')
}
