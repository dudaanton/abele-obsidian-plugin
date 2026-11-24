/** Native typing can report success while the responder drops the first characters. */
export async function typeField(
  text: string,
  field: {
    type: (text: string) => void
    read: () => string
    select: () => void
  }
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) field.select()
    field.type(text)
    // Let the WebView receive the native edit before deciding whether it was lost.
    const deadline = Date.now() + 1500
    do {
      if (field.read() === text) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    } while (Date.now() < deadline)
  }
  throw new Error('Native typing did not fill the field')
}
