/**
 * Archive: every alert that is over (answered, cancelled, expired, missed) and every finished live
 * task (done, failed or stopped), newest first, by day. A task opens its timeline (`LiveTimeline`).
 * Opened from the one "Archive · N earlier" row at the bottom of Home. The history used to be an
 * inline "Earlier" list on Home; it lives here so Home stays about what is waiting.
 *
 * Back (the arrow, or the Android back gesture) returns to Home. A tap on a row opens the alert's
 * detail (H4); Back from the detail returns here, because Home keeps this screen mounted under it.
 *
 * `Archive` only draws: it is given the history and callbacks, so the dev sample route can show it
 * with no backend. `ConnectedArchive` reads `alerts.history` (`useHistory`) and `bots.list`.
 */
import { anyApi } from "convex/server";
import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { BackHandler, ScrollView, StyleSheet, View } from "react-native";
import { flockBots } from "../botsModel";
import { knownBots, type HistoryItem, type KnownBot } from "../homeModel";
import { archiveGroups, type ArchivedLive, type LiveArchiveRowModel } from "../liveArchive";
import { Blob } from "../ui/Blob";
import { Glyph, ICON } from "../ui/AlertFrame";
import { Row } from "../ui/Row";
import { useTheme } from "../ui/theme";
import { useBotLook } from "../ui/useBotLook";
import { LiveTimeline } from "./LiveTimeline";
import { OnboardingFrame } from "../onboarding/parts";
import { type HistoryStatus, useHistory } from "../useHistory";
import { useBots } from "../useBots";
import { Btn } from "../ui/Btn";
import { HistoryRow, Section } from "./H1Home";
import { NavBar } from "./PairingParts";

export interface ArchiveProps {
  /** The history so far, newest first; undefined while the first page loads. */
  history: readonly HistoryItem[] | undefined;
  historyStatus: HistoryStatus;
  onLoadMore: () => void;
  /** Finished live tasks, newest first; undefined while they load. */
  live?: readonly ArchivedLive[] | undefined;
  /** The bots seen so far, to match a row to its bot's look. */
  bots: readonly KnownBot[];
  now: number;
  /** A tap on a row: H4, the alert's detail. */
  onOpenAlert: (questionId: string) => void;
  onBack: () => void;
}

export function Archive({ history, historyStatus, onLoadMore, live, bots, now, onOpenAlert, onBack }: ArchiveProps) {
  const moreAlerts = historyStatus === "canLoadMore" || historyStatus === "loadingMore";
  const groups = useMemo(() => archiveGroups(history ?? [], live ?? [], moreAlerts, now), [history, live, moreAlerts, now]);
  const idByName = useMemo(() => new Map(bots.map((bot) => [bot.botName, bot.botId])), [bots]);
  const [openTask, setOpenTask] = useState<ArchivedLive | null>(null);

  if (openTask) return <LiveTimeline item={openTask} onBack={() => setOpenTask(null)} />;

  return (
    <OnboardingFrame>
      <NavBar title="Archive" onBack={onBack} backTestID="archive-back" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {groups.map((group) => (
          <View key={group.label}>
            <Section label={group.label} />
            {group.entries.map((entry) =>
              entry.kind === "alert" ? (
                <HistoryRow
                  key={entry.row.questionId}
                  row={entry.row}
                  botId={idByName.get(entry.row.botName) ?? entry.row.botName}
                  onPress={() => onOpenAlert(entry.row.questionId)}
                  testID="archive-item"
                />
              ) : (
                <TaskRow key={entry.row.activityId} row={entry.row} onPress={() => setOpenTask(entry.item)} />
              ),
            )}
          </View>
        ))}

        {historyStatus === "canLoadMore" || historyStatus === "loadingMore" ? (
          <View style={styles.more}>
            <Btn
              label={historyStatus === "loadingMore" ? "Loading…" : "Load more"}
              variant="line"
              disabled={historyStatus === "loadingMore"}
              onPress={onLoadMore}
              testID="archive-load-more"
            />
          </View>
        ) : null}
      </ScrollView>
    </OnboardingFrame>
  );
}

/** Archive on Convex, with the Android back gesture going back to Home. */
export function ConnectedArchive({
  clientId,
  onOpenAlert,
  onClose,
  active = true,
}: {
  clientId: string | null | undefined;
  onOpenAlert: (questionId: string) => void;
  onClose: () => void;
  /** False while the alert detail is up over this screen: the back gesture then belongs to the detail. */
  active?: boolean;
}) {
  const { history, loading, status, onLoadMore } = useHistory(clientId);
  const live = useQuery(anyApi.live.archive, clientId ? { clientId } : "skip") as ArchivedLive[] | undefined;
  const botList = useBots(clientId);
  const bots = useMemo(() => (botList ? flockBots(botList) : knownBots([], history)), [botList, history]);
  const now = useNow();
  useEffect(() => {
    if (!active) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [active, onClose]);
  return (
    <Archive
      history={loading ? undefined : history}
      historyStatus={status}
      onLoadMore={onLoadMore}
      live={live}
      bots={bots}
      now={now}
      onOpenAlert={onOpenAlert}
      onBack={onClose}
    />
  );
}

/** A finished task: the bot, the task's name, and "Done · 6 steps · 1 min 15 s". */
function TaskRow({ row, onPress }: { row: LiveArchiveRowModel; onPress: () => void }) {
  const t = useTheme().tokens;
  const { botId, botName } = row;
  const bot = useBotLook({ botId, botName });
  const colour = row.tone === "ok" ? t.ok : row.tone === "bad" ? t.danger : t.ink2;
  return (
    <Row
      title={botName}
      subtitle={row.title}
      time={row.time}
      detail={row.detail}
      detailTone={row.tone}
      detailIcon={
        row.icon === "check" ? (
          <Glyph d={ICON.check} size={14} colour={colour} width={2.6} />
        ) : row.icon === "warn" ? (
          <Glyph d={WARN} size={14} colour={colour} width={2.6} />
        ) : undefined
      }
      leading={<Blob bot={bot} size={40} />}
      onPress={onPress}
      testID="archive-task"
    />
  );
}

const WARN = "M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01";

/** A clock that ticks every 30 s, so the day groups follow midnight. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 28 },
  more: { paddingTop: 16, paddingHorizontal: 16 },
});
