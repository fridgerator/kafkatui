import type { Kafka } from "kafkajs"
import { useKeyboard, useRenderer } from "@opentui/react"
import { useCallback, useState } from "react"
import { HintBar } from "./components/HintBar"
import { StatusBar } from "./components/StatusBar"
import { TABS, TabBar, type TabId } from "./components/TabBar"
import { ConsumeTab, type ConsumeStatus } from "./components/consume/ConsumeTab"
import { GroupsTab } from "./components/groups/GroupsTab"
import { ProduceTab } from "./components/produce/ProduceTab"
import { TopicsTab } from "./components/topics/TopicsTab"
import { KafkaClientProvider } from "./kafka/KafkaClientContext"
import { theme } from "./theme/monokai"

/**
 * Exhaustive switch rather than a `Record<TabId, FC>` lookup: React 19's `FC`
 * return type includes `Promise<ReactNode>` (async components), which OpenTUI's
 * JSX element type rejects. The switch also makes adding a tab a compile error
 * here until it is handled.
 */
function TabContent({
  activeTab,
  ringBufferSize,
  onConsumeStatusChange,
  onInputActiveChange,
}: {
  activeTab: TabId
  ringBufferSize: number
  onConsumeStatusChange: (status: ConsumeStatus) => void
  onInputActiveChange: (active: boolean) => void
}) {
  switch (activeTab) {
    case "consume":
      return (
        <ConsumeTab
          ringBufferSize={ringBufferSize}
          onStatusChange={onConsumeStatusChange}
          onInputActiveChange={onInputActiveChange}
        />
      )
    case "groups":
      return <GroupsTab />
    case "topics":
      return <TopicsTab />
    case "produce":
      return <ProduceTab />
  }
}

interface AppProps {
  profileName: string
  kafka: Kafka
  ringBufferSize: number
}

export function App({ profileName, kafka, ringBufferSize }: AppProps) {
  const renderer = useRenderer()
  const [activeTab, setActiveTab] = useState<TabId>("consume")
  const [inputActive, setInputActive] = useState(false)
  const [consumeStatus, setConsumeStatus] = useState<ConsumeStatus>({ connection: "disconnected", topic: null })

  const handleConsumeStatusChange = useCallback((status: ConsumeStatus) => setConsumeStatus(status), [])

  useKeyboard((key) => {
    // While a tab has a text input focused (e.g. Consume's topic field), every
    // other global shortcut stands down — otherwise typing "2" or "queue" would
    // switch tabs or quit mid-keystroke. OpenTUI's `useKeyboard` is a single
    // global subscription regardless of which renderable has `focused`, so this
    // gate is the app's responsibility, not something OpenTUI does for us.
    if (inputActive) return

    // Digit keys 1-4 jump straight to a tab. `sequence` is checked alongside
    // `name` because digit key naming differs between the raw and kitty
    // keyboard parsers.
    const digit = Number.parseInt(key.name || key.sequence, 10)
    if (Number.isInteger(digit) && digit >= 1 && digit <= TABS.length) {
      const tab = TABS[digit - 1]
      if (tab) {
        setActiveTab(tab.id)
        return
      }
    }

    if (key.name === "tab") {
      const step = key.shift ? -1 : 1
      setActiveTab((current) => {
        const index = TABS.findIndex((tab) => tab.id === current)
        const next = TABS[(index + step + TABS.length) % TABS.length]
        return next ? next.id : current
      })
      return
    }

    if (key.name === "q" && !key.ctrl && !key.meta) {
      renderer.destroy()
      process.exit(0)
    }
  })

  return (
    <KafkaClientProvider client={kafka}>
      <box
        style={{
          flexDirection: "column",
          width: "100%",
          height: "100%",
          backgroundColor: theme.bg,
        }}
      >
        <StatusBar
          profile={profileName}
          connection={activeTab === "consume" ? consumeStatus.connection : "disconnected"}
          topic={activeTab === "consume" ? (consumeStatus.topic ?? undefined) : undefined}
        />
        <TabBar activeTab={activeTab} />

        {/*
          `overflow: hidden` is load-bearing: without it, tab content taller than
          the panel paints over its siblings instead of being clipped, which
          garbles the frame on short terminals. Panes that need to show more than
          fits get a scrollbox of their own in later phases.
        */}
        <box
          style={{
            flexGrow: 1,
            flexDirection: "column",
            overflow: "hidden",
            border: true,
            borderStyle: "rounded",
            borderColor: theme.border,
            backgroundColor: theme.bg,
          }}
        >
          <TabContent
            activeTab={activeTab}
            ringBufferSize={ringBufferSize}
            onConsumeStatusChange={handleConsumeStatusChange}
            onInputActiveChange={setInputActive}
          />
        </box>

        <HintBar activeTab={activeTab} />
      </box>
    </KafkaClientProvider>
  )
}
