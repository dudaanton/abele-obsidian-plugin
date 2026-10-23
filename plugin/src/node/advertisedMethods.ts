import { z } from 'zod'

// The current SDK retains the welcome on its RequestChannel without a public getter.
// Keep the transport-shape adapter here until the SDK exposes advertised methods directly.
const ClientWelcome = z.object({
  channel: z.object({
    channel: z.object({ welcome: z.object({ methods: z.array(z.string()) }) }),
  }),
})

export function nodeAdvertisedMethods(client: unknown): readonly string[] | undefined {
  const parsed = ClientWelcome.safeParse(client)
  return parsed.success ? parsed.data.channel.channel.welcome.methods : undefined
}

export function nodeAdvertisesMethod(client: unknown, method: string): boolean {
  return nodeAdvertisedMethods(client)?.includes(method) ?? false
}
