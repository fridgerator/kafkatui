import { useKeyboard } from "@opentui/react"
import { useEffect, useMemo, useState } from "react"
import { useGroupsData } from "../../kafka/GroupsDataContext"
import { Sparkline } from "../Sparkline"
import { theme } from "../../theme/monokai"
import { SearchBox } from "../SearchBox"
import { useListViewport } from "../useListViewport"
import { GroupDetail } from "./GroupDetail"

/** Spec §8.3: "flag groups where lag is nonzero but not decreasing." Only the trailing
 * few samples are checked (not the full sparkline history) so a genuinely stuck group is
 * flagged within ~15s, not after the full 30-sample/2.5-minute window fills up. */
const STUCK_WINDOW = 3
const POLL_INTERVAL_MS = 5000

export function isGroupStuck(history: number[]): boolean {
  if (history.length < STUCK_WINDOW) return false
  const window = history.slice(-STUCK_WINDOW)
  const current = window[window.length - 1] as number
  if (current <= 0) return false
  const oldest = window[0] as number
  return current >= oldest
}

interface GroupsTabProps {
  onInputActiveChange: (active: boolean) => void
}

/**
 * The polled snapshots, selection, sort, and search query all live in `GroupsDataContext` —
 * mounted once at the `App` level. Polling starts the first time this tab is visited and never
 * stops (spec change: previously "switching away from the Groups tab stops polling and
 * disconnects its admin client entirely ... coming back starts fresh"), so returning to this tab
 * shows an instantly up-to-date, gap-free view instead of reconnecting from scratch.
 */
export function GroupsTab({ onInputActiveChange }: GroupsTabProps) {
  const {
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
  } = useGroupsData()

  const [editingSearch, setEditingSearch] = useState(false)
  const [searchDraft, setSearchDraft] = useState("")
  const [detailOpen, setDetailOpen] = useState(false)

  useEffect(() => {
    ensurePolling()
  }, [ensurePolling])

  useEffect(() => {
    onInputActiveChange(editingSearch)
  }, [editingSearch, onInputActiveChange])

  const sortedGroups = useMemo(() => {
    const groups = [...snapshots.values()]
    if (sortByLag) {
      groups.sort((a, b) => b.totalLag - a.totalLag)
    } else {
      groups.sort((a, b) => a.groupId.localeCompare(b.groupId))
    }
    return groups
  }, [snapshots, sortByLag])

  const filteredGroups = useMemo(() => {
    if (!searchQuery) return sortedGroups
    const q = searchQuery.toLowerCase()
    return sortedGroups.filter((g) => g.groupId.toLowerCase().includes(q))
  }, [sortedGroups, searchQuery])

  // Self-heal: if the current selection dropped out of the filtered list (search narrowed it, or
  // the group went idle and got cleaned up), fall back to the filtered list's first entry.
  useEffect(() => {
    if (filteredGroups.length === 0) {
      if (selectedGroupId !== null) setSelectedGroupId(null)
      return
    }
    if (!filteredGroups.some((g) => g.groupId === selectedGroupId)) {
      setSelectedGroupId(filteredGroups[0]!.groupId)
    }
  }, [filteredGroups, selectedGroupId, setSelectedGroupId])

  const { boxRef, rowCount, viewportStart, scrollToIndex } = useListViewport(filteredGroups.length)

  useKeyboard((key) => {
    if (detailOpen) return // GroupDetail owns its own useKeyboard while mounted (mount-scoped, see MessageDetail)

    if (editingSearch) {
      if (key.name === "escape") setEditingSearch(false)
      return
    }

    switch (key.name) {
      case "s":
        setSortByLag((v) => !v)
        break
      case "/":
        setSearchDraft(searchQuery)
        setEditingSearch(true)
        break
      case "up": {
        if (filteredGroups.length === 0) break
        const idx = filteredGroups.findIndex((g) => g.groupId === selectedGroupId)
        const nextIdx = idx <= 0 ? 0 : idx - 1
        const next = filteredGroups[nextIdx]
        if (next) {
          setSelectedGroupId(next.groupId)
          scrollToIndex(nextIdx)
        }
        break
      }
      case "down": {
        if (filteredGroups.length === 0) break
        const idx = filteredGroups.findIndex((g) => g.groupId === selectedGroupId)
        const nextIdx = idx === -1 ? 0 : Math.min(filteredGroups.length - 1, idx + 1)
        const next = filteredGroups[nextIdx]
        if (next) {
          setSelectedGroupId(next.groupId)
          scrollToIndex(nextIdx)
        }
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
          aggregateHistory={getAggregateHistory(selectedGroupId)}
          getPartitionHistory={(topic, partition) => getPartitionHistory(selectedGroupId, topic, partition)}
          onClose={() => setDetailOpen(false)}
        />
      )
    }
    // The group vanished between opening detail and this render (e.g. it went idle and was
    // cleaned up) — fall through to the list rather than showing a stale/blank detail pane.
  }

  const visible = filteredGroups.slice(viewportStart, viewportStart + rowCount)

  return (
    <box style={{ flexDirection: "column", flexGrow: 1, overflow: "hidden" }}>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, gap: 2, paddingLeft: 1 }}>
        <text fg={theme.fgDim}>
          {`${filteredGroups.length} group${filteredGroups.length === 1 ? "" : "s"}`}
          {searchQuery ? ` (of ${sortedGroups.length})` : ""}
        </text>
        <text fg={theme.fgDim}>{`polling every ${POLL_INTERVAL_MS / 1000}s`}</text>
        <text fg={theme.fgDim}>{`sorted by ${sortByLag ? "lag" : "group ID"} (s to toggle)`}</text>
        {pollError && (
          <text fg={theme.error} truncate wrapMode="none">
            {pollError}
          </text>
        )}
      </box>
      <SearchBox
        editing={editingSearch}
        draft={searchDraft}
        onDraftChange={setSearchDraft}
        onSubmit={(value) => {
          setSearchQuery(value)
          setEditingSearch(false)
        }}
        committedQuery={searchQuery}
        placeholder="group ID substring"
      />
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, paddingLeft: 1 }}>
        <text fg={theme.fgDim} truncate wrapMode="none">
          {`${"GROUP ID".padEnd(28)}${"STATE".padEnd(12)}${"MEMBERS".padEnd(9)}${"LAG".padStart(8)}  TREND`}
        </text>
      </box>
      <box ref={boxRef} style={{ flexGrow: 1, flexDirection: "column", overflow: "hidden" }}>
        {filteredGroups.length === 0 ? (
          <box style={{ flexGrow: 1, flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
            <text fg={theme.fgDim}>
              {pollError
                ? "Unable to reach the cluster."
                : searchQuery
                  ? "No groups match."
                  : "No consumer groups found."}
            </text>
          </box>
        ) : (
          visible.map((group) => {
            const history = getAggregateHistory(group.groupId)
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
