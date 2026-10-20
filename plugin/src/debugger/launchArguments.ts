/** Splits argument text without evaluating a shell, variables, globbing or substitutions. */
export function parseLaunchArguments(text: string): string[] {
  const args: string[] = []
  let word = '',
    quote = '',
    escaped = false,
    started = false
  for (const char of text) {
    if (escaped) {
      word += char
      escaped = false
    } else if (char === '\\' && quote !== "'") {
      escaped = true
      started = true
    } else if (quote) {
      if (char === quote) quote = ''
      else word += char
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started) args.push(word)
      word = ''
      started = false
    } else {
      word += char
      started = true
    }
  }
  if (quote || escaped) throw new Error('incomplete_arguments')
  if (started) args.push(word)
  return args
}
