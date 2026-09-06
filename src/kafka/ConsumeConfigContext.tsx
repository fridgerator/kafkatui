import { createContext, useContext, useState, type ReactNode } from "react"

/** Which of the modal's three radio-style choices is selected — distinct from
 *  `consume.ts`'s `StartPosition`, which is the resolved instruction actually handed to
 *  kafkajs (`"earliest" | "latest" | { timestamp }`) once a timestamp has been parsed. */
export type StartPositionKind = "earliest" | "latest" | "timestamp"

export interface ConsumeConfig {
  topic: string
  startPosition: StartPositionKind
  /** Raw text as typed in the modal, not the parsed number — re-validated on every submit
   *  rather than trusted from a previous session (the format this app accepts could change). */
  timestampInput: string
}

const DEFAULT_CONFIG: ConsumeConfig = { topic: "", startPosition: "latest", timestampInput: "" }

interface ConsumeConfigContextValue {
  /** The last configuration actually submitted via the modal's Connect button — not the
   *  in-progress draft, which stays local to `ConsumerConfigModal` (same draft-vs-committed
   *  split used for Topics/Groups search). Survives `ConsumeTab` unmounting on tab switch. */
  config: ConsumeConfig
  setConfig: (config: ConsumeConfig) => void
}

const ConsumeConfigContext = createContext<ConsumeConfigContextValue | null>(null)

export function ConsumeConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ConsumeConfig>(DEFAULT_CONFIG)
  return <ConsumeConfigContext.Provider value={{ config, setConfig }}>{children}</ConsumeConfigContext.Provider>
}

export function useConsumeConfig(): ConsumeConfigContextValue {
  const value = useContext(ConsumeConfigContext)
  if (!value) throw new Error("useConsumeConfig() called outside ConsumeConfigProvider")
  return value
}
