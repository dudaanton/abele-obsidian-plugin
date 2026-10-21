const languages: Readonly<Record<string, string>> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'typescript',
  jsx: 'typescript',
  mjs: 'typescript',
  cjs: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  py: 'python',
  pyi: 'python',
  rs: 'rust',
  go: 'go',
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  css: 'css',
  scss: 'css',
  less: 'css',
  html: 'html',
  sh: 'bash',
  bash: 'bash',
}

/** The server family shared by document admission and its status presentation. */
export function lspLanguage(path: string): string | undefined {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return Object.prototype.hasOwnProperty.call(languages, extension)
    ? languages[extension]
    : undefined
}
