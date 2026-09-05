import { theme } from "../theme/monokai"

export type ConnectionState = "connected" | "connecting" | "disconnected" | "failed"

const CONNECTION_COLOR: Record<ConnectionState, string> = {
  connected: theme.connected,
  connecting: theme.connecting,
  disconnected: theme.disconnected,
  failed: theme.failed,
}

interface StatusBarProps {
  profile: string
  connection: ConnectionState
  topic?: string
  consumerGroup?: string
}

/**
 * Persistent top status bar (spec §5).
 *
 * Phase 1 renders placeholder values only. Buffer fill and the throughput
 * sparkline described in §7 arrive with the ring buffer in phase 3.
 */
export function StatusBar({ profile, connection, topic, consumerGroup }: StatusBarProps) {
  return (
    <box
      style={{
        flexDirection: "row",
        height: 1,
        flexShrink: 0,
        backgroundColor: theme.statusBarBg,
        paddingLeft: 1,
        paddingRight: 1,
        gap: 2,
        overflow: "hidden",
      }}
    >
      <box style={{ flexDirection: "row", flexShrink: 0, backgroundColor: theme.statusBarBg }}>
        <text fg={CONNECTION_COLOR[connection]} bg={theme.statusBarBg}>
          {"● "}
        </text>
        <text fg={theme.statusBarFg} bg={theme.statusBarBg}>
          {profile}
        </text>
      </box>

      <box style={{ flexDirection: "row", flexShrink: 0, backgroundColor: theme.statusBarBg }}>
        <text fg={theme.fgDim} bg={theme.statusBarBg}>
          {"Topic: "}
        </text>
        <text fg={topic ? theme.info : theme.fgDim} bg={theme.statusBarBg}>
          {topic ?? "—"}
        </text>
      </box>

      <box style={{ flexDirection: "row", flexShrink: 0, backgroundColor: theme.statusBarBg }}>
        <text fg={theme.fgDim} bg={theme.statusBarBg}>
          {"Consumer Group: "}
        </text>
        <text fg={consumerGroup ? theme.info : theme.fgDim} bg={theme.statusBarBg}>
          {consumerGroup ?? "—"}
        </text>
      </box>
    </box>
  )
}
