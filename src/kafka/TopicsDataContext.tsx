import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react"
import { fetchTopicOverviews, type TopicOverview } from "./topics"
import { useKafkaClient } from "./KafkaClientContext"

interface TopicsDataContextValue {
  overviews: TopicOverview[]
  /** True only until the very first fetch (ever) resolves — a manual `refresh()` afterwards
   *  never blanks the list back to a loading state, it just replaces it once the new data lands. */
  loading: boolean
  fetchError: string | null
  selectedTopic: string | null
  setSelectedTopic: (name: string | null) => void
  searchQuery: string
  setSearchQuery: (query: string) => void
  /** Always re-fetches, regardless of whether one already happened. */
  refresh: () => void
  /** Fetches once, the first time anything calls this — a no-op on every call after (including
   *  across `TopicsTab` unmount/remount from switching tabs), which is what makes the fetched
   *  list survive navigating away and back instead of re-fetching every visit. */
  ensureFetched: () => void
}

const TopicsDataContext = createContext<TopicsDataContextValue | null>(null)

export function TopicsDataProvider({ children }: { children: ReactNode }) {
  const kafka = useKafkaClient()

  const [overviews, setOverviews] = useState<TopicOverview[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")

  const hasFetchedRef = useRef(false)
  const inFlightRef = useRef(false)

  const doFetch = useCallback(() => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    const admin = kafka.admin()

    admin
      .connect()
      .then(() => fetchTopicOverviews(admin))
      .then((result) => {
        setOverviews(result)
        setFetchError(null)
      })
      .catch((err) => {
        // Keep whatever was already fetched rather than blanking the list on a transient
        // refresh failure (same convention as GroupsTab's poll-error handling).
        setFetchError((err as Error).message)
      })
      .finally(() => {
        void admin.disconnect()
        inFlightRef.current = false
        hasFetchedRef.current = true
        setLoading(false)
      })
  }, [kafka])

  const refresh = useCallback(() => doFetch(), [doFetch])
  const ensureFetched = useCallback(() => {
    if (hasFetchedRef.current || inFlightRef.current) return
    doFetch()
  }, [doFetch])

  return (
    <TopicsDataContext.Provider
      value={{
        overviews,
        loading,
        fetchError,
        selectedTopic,
        setSelectedTopic,
        searchQuery,
        setSearchQuery,
        refresh,
        ensureFetched,
      }}
    >
      {children}
    </TopicsDataContext.Provider>
  )
}

export function useTopicsData(): TopicsDataContextValue {
  const value = useContext(TopicsDataContext)
  if (!value) throw new Error("useTopicsData() called outside TopicsDataProvider")
  return value
}
