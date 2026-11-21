/** The inspection states get their own capture budget instead of extending the chat probe. */
export function phoneLayoutDialogs(names: string[], syncOnly: boolean): string[] {
  return names.filter((name) => /^sync-(sections|check)-\d+$/.test(name) === syncOnly)
}
