/** Shared argument-boundary formatter extracted from the delegation approval card. */
export function commandLine(argv: readonly string[]): string {
  return argv
    .map((arg) => {
      if (/[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u.test(arg))
        return (
          "$'" +
          Array.from(arg, (char) => {
            if (char === "'" || char === '\\') return '\\' + char
            if (/[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u.test(char))
              return '\\U' + char.codePointAt(0)!.toString(16).padStart(8, '0')
            return char
          }).join('') +
          "'"
        )
      return /^[\w./=:%@,+-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'"'"'`)}'`
    })
    .join(' ')
}

export function commandFolder(path: string, root?: string, label?: string): string {
  if (label) {
    const base = root?.replace(/\/$/, '')
    const relative =
      base && (path === base || path.startsWith(base + '/'))
        ? path.slice(base.length).replace(/^\//, '')
        : path.startsWith('/')
          ? ''
          : path
    return [label, relative].filter(Boolean).join('/')
  }
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  const name = parts.at(-1) ?? ''
  return /^[a-f0-9-]{32,}$/i.test(name) ? '' : name
}
