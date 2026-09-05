import { useKeyboard, useRenderer } from "@opentui/react"
import { useState } from "react"
import { HintBar } from "./components/HintBar"
import { StatusBar } from "./components/StatusBar"
import { TABS, TabBar, type TabId } from "./components/TabBar"
import { ConsumeTab } from "./components/consume/ConsumeTab"
import { GroupsTab } from "./components/groups/GroupsTab"
import { ProduceTab } from "./components/produce/ProduceTab"
import { TopicsTab } from "./components/topics/TopicsTab"
import { theme } from "./theme/monokai"

/**
 * Exhaustive switch rather than a `Record<TabId, FC>` lookup: React 19's `FC`
 * return type includes `Promise<ReactNode>` (async components), which OpenTUI's
 * JSX element type rejects. The switch also makes adding a tab a compile error
 * here until it is handled.
 */
function TabContent({ activeTab }: { activeTab: TabId }) {
  switch (activeTab) {
    case "consume":
      return <ConsumeTab />
    case "groups":
      return <GroupsTab />
    case "topics":
      return <TopicsTab />
    case "produce":
      return <ProduceTab />
  }
}

export function App() {
  const renderer = useRenderer()
  const [activeTab, setActiveTab] = useState<TabId>("consume")

  useKeyboard((key) => {
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

    // No text input exists yet, so a bare `q` is safe to treat as quit. Once
    // the search box lands in phase 5 this must be gated on the focused pane.
    if (key.name === "q" && !key.ctrl && !key.meta) {
      renderer.destroy()
      process.exit(0)
    }
  })

  return (
    <box
      style={{
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: theme.bg,
      }}
    >
      <StatusBar profile="dev-local" connection="disconnected" />
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
        <TabContent activeTab={activeTab} />
      </box>

      <HintBar activeTab={activeTab} />
    </box>
  )
}
