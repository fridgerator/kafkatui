import { useKeyboard } from "@opentui/react"
import { useEffect, useMemo, useState } from "react"
import { useListViewport } from "../useListViewport"
import { useTopicsData } from "../../kafka/TopicsDataContext"
import { theme } from "../../theme/monokai"
import { SearchBox } from "../SearchBox"
import { TopicDetail } from "./TopicDetail"

interface TopicsTabProps {
  onInputActiveChange: (active: boolean) => void
}

/**
 * The fetched list, selection, and search query all live in `TopicsDataContext` — mounted once
 * at the `App` level, so they survive this component unmounting when you switch tabs away (spec
 * change: previously "switching tabs away and back is the implicit refresh"; now the list is
 * fetched once, ever, automatically, and `r` forces a manual re-fetch on demand).
 */
export function TopicsTab({ onInputActiveChange }: TopicsTabProps) {
  const {
    overviews,
    loading,
    fetchError,
    selectedTopic,
    setSelectedTopic,
    searchQuery,
    setSearchQuery,
    refresh,
    ensureFetched,
  } = useTopicsData()

  const [editingSearch, setEditingSearch] = useState(false)
  const [searchDraft, setSearchDraft] = useState("")
  const [detailOpen, setDetailOpen] = useState(false)

  useEffect(() => {
    ensureFetched()
  }, [ensureFetched])

  useEffect(() => {
    onInputActiveChange(editingSearch)
  }, [editingSearch, onInputActiveChange])

  const sortedTopics = useMemo(() => [...overviews].sort((a, b) => a.name.localeCompare(b.name)), [overviews])

  const filteredTopics = useMemo(() => {
    if (!searchQuery) return sortedTopics
    const q = searchQuery.toLowerCase()
    return sortedTopics.filter((t) => t.name.toLowerCase().includes(q))
  }, [sortedTopics, searchQuery])

  // Self-heal: if the current selection dropped out of the filtered list (search narrowed it, or
  // a refresh removed the topic), fall back to the filtered list's first entry.
  useEffect(() => {
    if (filteredTopics.length === 0) {
      if (selectedTopic !== null) setSelectedTopic(null)
      return
    }
    if (!filteredTopics.some((t) => t.name === selectedTopic)) {
      setSelectedTopic(filteredTopics[0]!.name)
    }
  }, [filteredTopics, selectedTopic, setSelectedTopic])

  const { boxRef, rowCount, viewportStart, scrollToIndex } = useListViewport(filteredTopics.length)

  useKeyboard((key) => {
    if (detailOpen) return // TopicDetail owns its own useKeyboard while mounted (mount-scoped, see MessageDetail)

    if (editingSearch) {
      if (key.name === "escape") setEditingSearch(false)
      return
    }

    switch (key.name) {
      case "/":
        setSearchDraft(searchQuery)
        setEditingSearch(true)
        break
      case "r":
        refresh()
        break
      case "up": {
        if (filteredTopics.length === 0) break
        const idx = filteredTopics.findIndex((t) => t.name === selectedTopic)
        const nextIdx = idx <= 0 ? 0 : idx - 1
        const next = filteredTopics[nextIdx]
        if (next) {
          setSelectedTopic(next.name)
          scrollToIndex(nextIdx)
        }
        break
      }
      case "down": {
        if (filteredTopics.length === 0) break
        const idx = filteredTopics.findIndex((t) => t.name === selectedTopic)
        const nextIdx = idx === -1 ? 0 : Math.min(filteredTopics.length - 1, idx + 1)
        const next = filteredTopics[nextIdx]
        if (next) {
          setSelectedTopic(next.name)
          scrollToIndex(nextIdx)
        }
        break
      }
      case "return":
        if (selectedTopic) setDetailOpen(true)
        break
    }
  })

  if (detailOpen && selectedTopic) {
    return <TopicDetail topic={selectedTopic} onClose={() => setDetailOpen(false)} />
  }

  const visible = filteredTopics.slice(viewportStart, viewportStart + rowCount)

  return (
    <box style={{ flexDirection: "column", flexGrow: 1, overflow: "hidden" }}>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, gap: 2, paddingLeft: 1 }}>
        <text fg={theme.fgDim}>
          {`${filteredTopics.length} topic${filteredTopics.length === 1 ? "" : "s"}`}
          {searchQuery ? ` (of ${sortedTopics.length})` : ""}
        </text>
        {fetchError && (
          <text fg={theme.error} truncate wrapMode="none">
            {fetchError}
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
        placeholder="topic name substring"
      />
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, paddingLeft: 1 }}>
        <text fg={theme.fgDim} truncate wrapMode="none">
          {`${"TOPIC".padEnd(32)}${"PARTITIONS".padEnd(12)}REPLICATION`}
        </text>
      </box>
      <box ref={boxRef} style={{ flexGrow: 1, flexDirection: "column", overflow: "hidden" }}>
        {filteredTopics.length === 0 ? (
          <box style={{ flexGrow: 1, flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
            <text fg={theme.fgDim}>
              {loading ? "Loading…" : searchQuery ? "No topics match." : "No topics found."}
            </text>
          </box>
        ) : (
          visible.map((topic) => {
            const selected = topic.name === selectedTopic
            const row =
              `${topic.name.length > 31 ? `${topic.name.slice(0, 30)}…` : topic.name.padEnd(32)}` +
              `${String(topic.partitionCount).padEnd(12)}${topic.replicationFactor}`
            return (
              <box key={topic.name} style={{ flexDirection: "row", height: 1, flexShrink: 0, paddingLeft: 1 }}>
                <text fg={theme.fg} bg={selected ? theme.bgSelected : undefined} truncate wrapMode="none">
                  {row}
                </text>
              </box>
            )
          })
        )}
      </box>
    </box>
  )
}
