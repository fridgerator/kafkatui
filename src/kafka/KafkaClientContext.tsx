import type { Kafka } from "kafkajs"
import { createContext, useContext, type ReactNode } from "react"

const KafkaClientContext = createContext<Kafka | null>(null)

export function KafkaClientProvider({ client, children }: { client: Kafka; children: ReactNode }) {
  return <KafkaClientContext.Provider value={client}>{children}</KafkaClientContext.Provider>
}

/** One shared `Kafka` client instance for the whole app — Groups/Topics tabs reuse it too. */
export function useKafkaClient(): Kafka {
  const client = useContext(KafkaClientContext)
  if (!client) throw new Error("useKafkaClient() called outside KafkaClientProvider")
  return client
}
