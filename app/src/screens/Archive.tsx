/**
 * Archive: every alert that is over (answered, cancelled, expired, missed), newest first, by day.
 * Opened from the one "Archive · N earlier" row at the bottom of Home. The history used to be an
 * inline "Earlier" list on Home; it lives here so Home stays about what is waiting.
 *
 * Back (the arrow, or the Android back gesture) returns to Home. A tap on a row opens the alert's
 * detail (H4); Back from the detail returns here, because Home keeps this screen mounted under it.
 *
 * `Archive` only draws: it is given the history and callbacks, so the dev sample route can show it
 * with no backend. `ConnectedArchive` reads `alerts.history` (`useHistory`) and `bots.list`.
 */
import { useEffect, useMemo, useState } from "react";
import { BackHandler, ScrollView, StyleSheet, View } from "react-native";
import { flockBots } from "../botsModel";
import { groupByDay, knownBots, type HistoryItem, type KnownBot } from "../homeModel";
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
  /** The bots seen so far, to match a row to its bot's look. */
  bots: readonly KnownBot[];
  now: number;
  /** A tap on a row: H4, the alert's detail. */
  onOpenAlert: (questionId: string) => void;
  onBack: () => void;
}

export function Archive({ history, historyStatus, onLoadMore, bots, now, onOpenAlert, onBack }: ArchiveProps) {
  const groups = useMemo(() => groupByDay(history ?? [], now), [history, now]);
  const idByName = useMemo(() => new Map(bots.map((bot) => [bot.botName, bot.botId])), [bots]);

  return (
    <OnboardingFrame>
      <NavBar title="Archive" onBack={onBack} backTestID="archive-back" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {groups.map((group) => (
          <View key={group.label}>
            <Section label={group.label} />
            {group.rows.map((row) => (
              <HistoryRow
                key={row.questionId}
                row={row}
                botId={idByName.get(row.botName) ?? row.botName}
                onPress={() => onOpenAlert(row.questionId)}
                testID="archive-item"
              />
            ))}
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
      bots={bots}
      now={now}
      onOpenAlert={onOpenAlert}
      onBack={onClose}
    />
  );
}

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
