import { theme } from "../theme/monokai"

export const TABS = [
  { id: "consume", label: "Consume" },
  { id: "groups", label: "Groups" },
  { id: "topics", label: "Topics" },
  { id: "produce", label: "Produce" },
] as const

export type TabId = (typeof TABS)[number]["id"]

interface TabBarProps {
  activeTab: TabId
}

/**
 * Tab strip rendered as a plain box row rather than OpenTUI's `<tab-select>`.
 *
 * `<tab-select>` owns its own keybindings (move-left/move-right/select-current)
 * and requires focus to receive them, which would compete with the app-level
 * `1`-`4`/Tab handler in app.tsx and force focus juggling once panes inside a
 * tab become focusable in later phases. A static row keeps tab switching purely
 * a function of app state, and gives us the `[1] Consume` numbering the spec
 * mocks up in §5.
 */
export function TabBar({ activeTab }: TabBarProps) {
  return (
    <box
      style={{
        flexDirection: "row",
        height: 1,
        backgroundColor: theme.tabInactiveBg,
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      {TABS.map((tab, index) => {
        const isActive = tab.id === activeTab
        return (
          <box
            key={tab.id}
            style={{
              flexDirection: "row",
              flexShrink: 0,
              paddingLeft: 1,
              paddingRight: 1,
              backgroundColor: isActive ? theme.tabActiveBg : theme.tabInactiveBg,
            }}
          >
            <text
              fg={isActive ? theme.accent : theme.fgDim}
              bg={isActive ? theme.tabActiveBg : theme.tabInactiveBg}
            >
              {`[${index + 1}] `}
            </text>
            <text
              fg={isActive ? theme.tabActiveFg : theme.tabInactiveFg}
              bg={isActive ? theme.tabActiveBg : theme.tabInactiveBg}
            >
              {tab.label}
            </text>
          </box>
        )
      })}
    </box>
  )
}
