/**
 * The alert history from Convex (`alerts.history`), a page at a time, for Home (does any exist?) and
 * the Archive screen (all of it, with "Load more"). Convex shares the one subscription between them.
 */
import { anyApi } from "convex/server";
import { usePaginatedQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { HISTORY_PAGE, type HistoryItem } from "./homeModel";

export type HistoryStatus = "loading" | "canLoadMore" | "loadingMore" | "exhausted";

export interface HistoryState {
  /** The history so far, newest first (empty while the first page loads or without a client id). */
  history: HistoryItem[];
  /** True until the first page is here. */
  loading: boolean;
  status: HistoryStatus;
  onLoadMore: () => void;
}

export function useHistory(clientId: string | null | undefined): HistoryState {
  const paged = usePaginatedQuery(anyApi.alerts.history, clientId ? { clientId } : "skip", {
    initialNumItems: HISTORY_PAGE,
  });
  const history = clientId ? (paged.results as HistoryItem[]) : [];
  const status = paged.status as "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";

  // "Load more" keeps asking while pages come back short (a page holds only this client's alerts).
  const [wanted, setWanted] = useState(0);
  const { loadMore } = paged;
  useEffect(() => {
    if (wanted > history.length && status === "CanLoadMore") loadMore(HISTORY_PAGE);
  }, [wanted, history.length, status, loadMore]);
  const onLoadMore = useCallback(() => setWanted(history.length + HISTORY_PAGE), [history.length]);

  const historyStatus: HistoryStatus = !clientId
    ? "exhausted"
    : status === "LoadingFirstPage"
      ? "loading"
      : status === "CanLoadMore"
        ? wanted > history.length
          ? "loadingMore"
          : "canLoadMore"
        : status === "LoadingMore"
          ? "loadingMore"
          : "exhausted";
  return { history, loading: Boolean(clientId) && status === "LoadingFirstPage", status: historyStatus, onLoadMore };
}
