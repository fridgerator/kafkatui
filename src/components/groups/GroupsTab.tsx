import { useKeyboard } from "@opentui/react"
import { useEffect, useMemo, useRef, useState } from "react"
import { fetchGroupSnapshots, listRealGroupIds, type GroupSnapshot } from "../../kafka/groups"
import { useKafkaClient } from "../../kafka/KafkaClientContext"
import { Sparkline } from "../Sparkline"
import { theme } from "../../theme/monokai"
import { GroupDetail } from "./GroupDetail"

/** Spec §8.3: "flag groups where lag is nonzero but not decreasing." Only the trailing
 * few samples are checked (not the full sparkline history) so a genuinely stuck group is
 * flagged within ~15s, not after the full 30-sample/2.5-minute window fills up. */
const STUCK_WINDOW = 3
/** ~2.5 minutes of trend at the 5s poll interval below — enough for a readable sparkline. */
const HISTORY_LENGTH = 30
const POLL_INTERVAL_MS = 5000

export function isGroupStuck(history: number[]): boolean {
  if (history.length < STUCK_WINDOW) return false
  const window = history.slice(-STUCK_WINDOW)
  const current = window[window.length - 1] as number
  if (current <= 0) return false
  const oldest = window[0] as number
  return current >= oldest
}

function partitionHistoryKey(groupId: string, topic: string, partition: number): string {
  return `${groupId}:${topic}:${partition}`
}

function pushCapped(history: number[], value: number): number[] {
  const next = [...history, value]
  return next.length > HISTORY_LENGTH ? next.slice(next.length - HISTORY_LENGTH) : next
}

export function GroupsTab() {
  const kafka = useKafkaClient()

  const [snapshots, setSnapshots] = useState<Map<string, GroupSnapshot>>(new Map())
  const [pollError, setPollError] = useState<string | null>(null)
  const [sortByLag, setSortByLag] = useState(true)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const aggregateHistoryRef = useRef(new Map<string, number[]>())
  const partitionHistoryRef = useRef(new Map<string, number[]>())

  useEffect(() => {
    const admin = kafka.admin()
    let cancelled = false

    const poll = async () => {
      try {
        const groupIds = await listRealGroupIds(admin)
        const newSnapshots = await fetchGroupSnapshots(admin, groupIds)
        if (cancelled) return

        const liveGroupIds = new Set(newSnapshots.keys())
        for (const key of aggregateHistoryRef.current.keys()) {
          if (!liveGroupIds.has(key)) aggregateHistoryRef.current.delete(key)
        }
        for (const key of partitionHistoryRef.current.keys()) {
          const groupId = key.split(":")[0]
          if (groupId && !liveGroupIds.has(groupId)) partitionHistoryRef.current.delete(key)
        }

        for (const [groupId, snapshot] of newSnapshots) {
          const prevAgg = aggregateHistoryRef.current.get(groupId) ?? []
          aggregateHistoryRef.current.set(groupId, pushCapped(prevAgg, snapshot.totalLag))

          for (const p of snapshot.partitionLags) {
            const key = partitionHistoryKey(groupId, p.topic, p.partition)
            const prev = partitionHistoryRef.current.get(key) ?? []
            partitionHistoryRef.current.set(key, pushCapped(prev, p.lag ?? 0))
          }
        }

        setSnapshots(newSnapshots)
        setPollError(null)
      } catch (err) {
        if (!cancelled) setPollError((err as Error).message)
      }
    }

    let interval: ReturnType<typeof setInterval> | undefined
    admin
      .connect()
      .then(() => {
        if (cancelled) return
        void poll()
        interval = setInterval(poll, POLL_INTERVAL_MS)
      })
      .catch((err) => {
        if (!cancelled) setPollError(`Failed to connect: ${(err as Error).message}`)
      })

    return () => {
      cancelled = true
      if (interval) clearInterval(interval)
      void admin.disconnect()
    }
  }, [kafka])

  const sortedGroups = useMemo(() => {
    const groups = [...snapshots.values()]
    if (sortByLag) {
      groups.sort((a, b) => b.totalLag - a.totalLag)
    } else {
      groups.sort((a, b) => a.groupId.localeCompare(b.groupId))
    }
    return groups
  }, [snapshots, sortByLag])

  useKeyboard((key) => {
    if (detailOpen) return // GroupDetail owns its own useKeyboard while mounted (mount-scoped, see MessageDetail)

    switch (key.name) {
      case "s":
        setSortByLag((v) => !v)
        break
      case "up": {
        if (sortedGroups.length === 0) break
        const idx = sortedGroups.findIndex((g) => g.groupId === selectedGroupId)
        const next = sortedGroups[idx <= 0 ? 0 : idx - 1]
        if (next) setSelectedGroupId(next.groupId)
        break
      }
      case "down": {
        if (sortedGroups.length === 0) break
        const idx = sortedGroups.findIndex((g) => g.groupId === selectedGroupId)
        const next = sortedGroups[idx === -1 ? 0 : Math.min(sortedGroups.length - 1, idx + 1)]
        if (next) setSelectedGroupId(next.groupId)
        break
      }
      case "return":
        if (selectedGroupId && snapshots.has(selectedGroupId)) setDetailOpen(true)
        break
    }
  })

  if (detailOpen && selectedGroupId) {
    const snapshot = snapshots.get(selectedGroupId)
    if (snapshot) {
      return (
        <GroupDetail
          snapshot={snapshot}
          aggregateHistory={aggregateHistoryRef.current.get(selectedGroupId) ?? []}
          getPartitionHistory={(topic, partition) =>
            partitionHistoryRef.current.get(partitionHistoryKey(selectedGroupId, topic, partition)) ?? []
          }
          onClose={() => setDetailOpen(false)}
        />
      )
    }
    // The group vanished between opening detail and this render (e.g. it went idle and was
    // cleaned up) — fall through to the list rather than showing a stale/blank detail pane.
  }

  return (
    <box style={{ flexDirection: "column", flexGrow: 1, overflow: "hidden" }}>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, gap: 2, paddingLeft: 1 }}>
        <text fg={theme.fgDim}>{`${sortedGroups.length} group${sortedGroups.length === 1 ? "" : "s"}`}</text>
        <text fg={theme.fgDim}>{`polling every ${POLL_INTERVAL_MS / 1000}s`}</text>
        <text fg={theme.fgDim}>{`sorted by ${sortByLag ? "lag" : "group ID"} (s to toggle)`}</text>
        {pollError && (
          <text fg={theme.error} truncate wrapMode="none">
            {pollError}
          </text>
        )}
      </box>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, paddingLeft: 1 }}>
        <text fg={theme.fgDim} truncate wrapMode="none">
          {`${"GROUP ID".padEnd(28)}${"STATE".padEnd(12)}${"MEMBERS".padEnd(9)}${"LAG".padStart(8)}  TREND`}
        </text>
      </box>
      <box style={{ flexGrow: 1, flexDirection: "column", overflow: "hidden" }}>
        {sortedGroups.length === 0 ? (
          <box style={{ flexGrow: 1, flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
            <text fg={theme.fgDim}>
              {pollError ? "Unable to reach the cluster." : "No consumer groups found."}
            </text>
          </box>
        ) : (
          sortedGroups.map((group) => {
            const history = aggregateHistoryRef.current.get(group.groupId) ?? []
            const stuck = isGroupStuck(history)
            const selected = group.groupId === selectedGroupId
            const row =
              `${group.groupId.length > 27 ? `${group.groupId.slice(0, 26)}…` : group.groupId.padEnd(28)}` +
              `${group.state.padEnd(12)}${String(group.members.length).padEnd(9)}${group.totalLag.toLocaleString().padStart(8)}  `
            return (
              <box
                key={group.groupId}
                style={{ flexDirection: "row", height: 1, flexShrink: 0, paddingLeft: 1 }}
                backgroundColor={selected ? theme.bgSelected : undefined}
              >
                <text fg={theme.fg} bg={selected ? theme.bgSelected : undefined} truncate wrapMode="none">
                  {row}
                </text>
                <Sparkline values={history} fg={stuck ? theme.warning : theme.info} />
                {stuck && (
                  <text fg={theme.warning} flexShrink={0}>
                    {"  ⚠ stuck"}
                  </text>
                )}
              </box>
            )
          })
        )}
      </box>
    </box>
  )
}
