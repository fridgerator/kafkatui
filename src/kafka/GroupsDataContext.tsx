import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react"
import { fetchGroupSnapshots, listRealGroupIds, type GroupSnapshot } from "./groups"
import { useKafkaClient } from "./KafkaClientContext"

/** ~2.5 minutes of trend at the 5s poll interval below — enough for a readable sparkline. */
const HISTORY_LENGTH = 30
const POLL_INTERVAL_MS = 5000

function partitionHistoryKey(groupId: string, topic: string, partition: number): string {
  return `${groupId}:${topic}:${partition}`
}

function pushCapped(history: number[], value: number): number[] {
  const next = [...history, value]
  return next.length > HISTORY_LENGTH ? next.slice(next.length - HISTORY_LENGTH) : next
}

interface GroupsDataContextValue {
  snapshots: Map<string, GroupSnapshot>
  pollError: string | null
  sortByLag: boolean
  setSortByLag: (value: boolean | ((prev: boolean) => boolean)) => void
  selectedGroupId: string | null
  setSelectedGroupId: (id: string | null) => void
  searchQuery: string
  setSearchQuery: (query: string) => void
  getAggregateHistory: (groupId: string) => number[]
  getPartitionHistory: (groupId: string, topic: string, partition: number) => number[]
  /** Starts the connect+poll loop the first time anything calls this, and never stops it again
   *  (not even when `GroupsTab` unmounts) — see GroupsDataContext.tsx's doc comment. A re-mount
   *  (switching back to the tab) is a no-op, which is what makes the poll survive navigating
   *  away: the interval that's already running just keeps updating this context's state. */
  ensurePolling: () => void
}

const GroupsDataContext = createContext<GroupsDataContextValue | null>(null)

/**
 * Deliberately never torn down once started (contrast `TopicDetail`/`GroupDetail`, which still
 * disconnect on their own unmount — those are per-drill-down, this is the tab-level monitoring
 * loop). Lag/trend monitoring is inherently a "live" concern: stopping the poll while another tab
 * is active would leave gaps in the sparkline history and force a slow re-fetch on return, which
 * is exactly what this provider exists to avoid. The cost only applies to a user who has actually
 * opened the Groups tab at least once — `ensurePolling()` is lazy, not called at app startup.
 */
export function GroupsDataProvider({ children }: { children: ReactNode }) {
  const kafka = useKafkaClient()

  const [snapshots, setSnapshots] = useState<Map<string, GroupSnapshot>>(new Map())
  const [pollError, setPollError] = useState<string | null>(null)
  const [sortByLag, setSortByLag] = useState(true)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")

  const startedRef = useRef(false)
  const aggregateHistoryRef = useRef(new Map<string, number[]>())
  const partitionHistoryRef = useRef(new Map<string, number[]>())

  const ensurePolling = useCallback(() => {
    if (startedRef.current) return
    startedRef.current = true

    const admin = kafka.admin()

    const poll = async () => {
      try {
        const groupIds = await listRealGroupIds(admin)
        const newSnapshots = await fetchGroupSnapshots(admin, groupIds)

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
        setPollError((err as Error).message)
      }
    }

    admin
      .connect()
      .then(() => {
        void poll()
        setInterval(poll, POLL_INTERVAL_MS)
      })
      .catch((err) => {
        setPollError(`Failed to connect: ${(err as Error).message}`)
      })
  }, [kafka])

  const getAggregateHistory = useCallback(
    (groupId: string) => aggregateHistoryRef.current.get(groupId) ?? [],
    [],
  )
  const getPartitionHistory = useCallback(
    (groupId: string, topic: string, partition: number) =>
      partitionHistoryRef.current.get(partitionHistoryKey(groupId, topic, partition)) ?? [],
    [],
  )

  return (
    <GroupsDataContext.Provider
      value={{
        snapshots,
        pollError,
        sortByLag,
        setSortByLag,
        selectedGroupId,
        setSelectedGroupId,
        searchQuery,
        setSearchQuery,
        getAggregateHistory,
        getPartitionHistory,
        ensurePolling,
      }}
    >
      {children}
    </GroupsDataContext.Provider>
  )
}

export function useGroupsData(): GroupsDataContextValue {
  const value = useContext(GroupsDataContext)
  if (!value) throw new Error("useGroupsData() called outside GroupsDataProvider")
  return value
}
