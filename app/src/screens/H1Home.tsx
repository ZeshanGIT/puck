/**
 * H1 Home: the calm place he lands when nothing is paging him, and the list of everything that has.
 * Also H2 (no bots yet) and H3 (health banners). Prototype: `SCREENS.home`, `rowHTML`, `.hdr`,
 * `.sect`, `.needs`, `.clear`, `.flock` (`vault/Projects/Puck/mockups/Puck prototype.html`);
 * `App screens.md` H1, H2, H3; `User journeys.md` J10, J12.
 *
 * Top to bottom (each only when it has something):
 * - the header: the Puck wordmark with its blob, and the Bots and Settings icons;
 * - H3 banners, most serious first (`healthBanners` in `homeModel.ts`);
 * - H2 in place of the empty sections when no bot has ever paged him;
 * - "Needs you": a `NeedCard` per waiting alert, and "Go through all N" (two or more that can be
 *   answered from a stack);
 * - "Working now": an empty slot until live activities (P8);
 * - "All quiet" with the flock of still blobs, when nothing needs him;
 * - "Earlier": the history by day, a `Row` per alert, and "Load more" until the history is done.
 *
 * `H1Home` only draws: it is given its data and callbacks, so the dev sample route can show it with
 * no backend. `ConnectedH1Home` reads `alerts.waiting` and `alerts.history` from Convex and works
 * out the banners from the phone's real states.
 */
import { anyApi } from "convex/server";
import { useQuery, usePaginatedQuery } from "convex/react";
import { hasDndAccess } from "puck-full-screen";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { isQueuedLocally } from "../answerQueue";
import {
  BANNER_COPY,
  dndBypassActive,
  flockText,
  groupByDay,
  healthBanners,
  HISTORY_PAGE,
  isNoBotsYet,
  knownBots,
  needsTitle,
  needsYou,
  stackableCount,
  type BannerId,
  type HistoryItem,
  type HistoryRowModel,
  type KnownBot,
  type NeedItem,
  type WaitingAlert,
} from "../homeModel";
import { loadLocalSettings } from "../localSettings";
import { openDndAccessSettings } from "../onboarding/dndAccess";
import { ensureNotificationPermission, readNotificationRowState } from "../onboarding/notificationSetup";
import { Caption, CopyIcon, HeroText, OnboardingFrame } from "../onboarding/parts";
import { readableError } from "../session";
import { ageLabel, Glyph, ICON } from "../ui/AlertFrame";
import { Banner } from "../ui/Banner";
import { Blob } from "../ui/Blob";
import type { BlobBot } from "../ui/blobShapes";
import { botLook } from "../ui/botLook";
import { Btn } from "../ui/Btn";
import { NeedCard } from "../ui/NeedCard";
import { Row } from "../ui/Row";
import { useTheme } from "../ui/theme";
import { fontFamily } from "../ui/tokens";
import { useOnline } from "./A10Offline";

const MAX_FONT_SCALE = 1.3;
/** `BOTS.puck`: `mkBot("puck", "Puck", "sky", "round", 3)`. */
const PUCK_BLOB: BlobBot = { name: "Puck", colour: "sky", shape: "round", tilt: 3 };
const COMMAND = "puck add sheldon --colour coral";

/* ----------------------------------------------------------------------- the screen */

export type HistoryStatus = "loading" | "canLoadMore" | "loadingMore" | "exhausted";

export interface H1HomeProps {
  /** The banners to show, in order. */
  banners: readonly BannerId[];
  onBanner: (id: BannerId) => void;
  /** The "Needs you" cards; undefined while they load. */
  needs: readonly NeedItem[] | undefined;
  /** The history so far, newest first; undefined while the first page loads. */
  history: readonly HistoryItem[] | undefined;
  historyStatus: HistoryStatus;
  onLoadMore: () => void;
  /** The bots seen so far (the flock under "All quiet"). */
  bots: readonly KnownBot[];
  /** H2: nothing has ever paged him. */
  noBots: boolean;
  /** Now, so the ages and the day groups follow the clock. */
  now: number;
  /** A tap on a "Needs you" card. */
  onOpenNeed: (item: NeedItem) => void;
  /** "Go through all N". */
  onGoThroughAll: () => void;
  /** A tap on an "Earlier" row: H4, the alert's detail. */
  onOpenAlert: (questionId: string) => void;
  onBots: () => void;
  onSettings: () => void;
  onPairBot: () => void;
  /** Under everything: sign out, the dev links. */
  footer?: ReactNode;
}

export function H1Home(props: H1HomeProps) {
  const { banners, onBanner, needs, history, historyStatus, bots, noBots, now } = props;
  const t = useTheme().tokens;
  const groups = useMemo(() => groupByDay(history ?? [], now), [history, now]);
  const idByName = useMemo(() => new Map(bots.map((bot) => [bot.botName, bot.botId])), [bots]);
  const stackable = needs ? stackableCount(needs) : 0;
  const live = false; // P8: becomes "a live activity is running".
  const allClear = !noBots && needs !== undefined && needs.length === 0 && !live;

  return (
    <OnboardingFrame>
      <Header onBots={props.onBots} onSettings={props.onSettings} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {banners.map((id) => (
          <Banner
            key={id}
            message={BANNER_COPY[id].message}
            action={BANNER_COPY[id].action ? { label: BANNER_COPY[id].action!, onPress: () => onBanner(id) } : undefined}
          />
        ))}

        {noBots ? <NoBots onPairBot={props.onPairBot} /> : null}

        {needs && needs.length > 0 ? (
          <>
            <Section label={needsTitle(needs.length)} />
            <View style={styles.needs}>
              {/* P6: pairing requests (PAIRING cards) go first in this list. */}
              {needs.map((item) => (
                <NeedRow key={item.questionId} item={item} now={now} onPress={() => props.onOpenNeed(item)} />
              ))}
            </View>
            {stackable > 1 ? (
              <View style={styles.all}>
                <Btn label={`Go through all ${stackable}`} variant="line" onPress={props.onGoThroughAll} />
              </View>
            ) : null}
          </>
        ) : null}

        {/* P8: "Working now", the live activity cards (H5), go here. */}

        {allClear ? (
          <View style={styles.clear}>
            <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.clearTitle, { color: t.ink }]}>
              All quiet
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.clearBody, { color: t.ink2 }]}>
              Nothing needs you right now.
            </Text>
            {bots.length > 0 ? <Flock bots={bots} /> : null}
          </View>
        ) : null}

        {groups.map((group) => (
          <View key={group.label}>
            <Section label={group.label} />
            {group.rows.map((row) => (
              <HistoryRow
                key={row.questionId}
                row={row}
                botId={idByName.get(row.botName) ?? row.botName}
                onPress={() => props.onOpenAlert(row.questionId)}
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
              onPress={props.onLoadMore}
            />
          </View>
        ) : null}

        {props.footer}
      </ScrollView>
    </OnboardingFrame>
  );
}

/* ------------------------------------------------------------------------- parts */

/** `.hdr`: 56 dp high, the wordmark on the left, the two icon buttons on the right. */
function Header({ onBots, onSettings }: { onBots: () => void; onSettings: () => void }) {
  const t = useTheme().tokens;
  return (
    <View style={styles.header}>
      <View style={styles.brand} accessible accessibilityRole="header" accessibilityLabel="Puck">
        <Blob bot={PUCK_BLOB} size={28} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.brandText, { color: t.ink }]}>
          Puck
        </Text>
      </View>
      <View style={styles.icons}>
        <IconButton label="Bots" onPress={onBots}>
          <Svg width={23} height={23} viewBox="0 0 24 24">
            <Circle cx={8} cy={9} r={4.2} {...iconStroke(t.ink)} />
            <Path d="M14.5 6.5h4a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2z" {...iconStroke(t.ink)} />
            <Circle cx={12} cy={18} r={3.4} {...iconStroke(t.ink)} />
          </Svg>
        </IconButton>
        <IconButton label="Settings" onPress={onSettings}>
          <Svg width={23} height={23} viewBox="0 0 24 24">
            <Circle cx={12} cy={12} r={3.2} {...iconStroke(t.ink)} />
            <Path d={GEAR} {...iconStroke(t.ink)} />
          </Svg>
        </IconButton>
      </View>
    </View>
  );
}

/** `ICON.gear` of the prototype, without its centre circle. */
const GEAR =
  "M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z";

function iconStroke(colour: string) {
  return {
    fill: "none",
    stroke: colour,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

/** `.iconbtn`: 44 dp round, the icon in `ink`. */
function IconButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  const t = useTheme().tokens;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed ? { backgroundColor: t.fill } : null]}
    >
      {children}
    </Pressable>
  );
}

/** `.sect`: 12.5 / 900, upper case, wide tracking, in `ink3`. */
function Section({ label }: { label: string }) {
  const t = useTheme().tokens;
  return (
    <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.section, { color: t.ink3 }]}>
      {label}
    </Text>
  );
}

function NeedRow({ item, now, onPress }: { item: NeedItem; now: number; onPress: () => void }) {
  const t = useTheme().tokens;
  const { botId, botName } = item;
  const bot = useMemo(() => botLook({ botId, botName }), [botId, botName]);
  return (
    <NeedCard
      bot={bot}
      name={botName}
      question={item.question}
      time={ageLabel(item.createdAt, now)}
      tag={item.urgent ? { label: "URGENT", urgent: true } : undefined}
      urgent={item.urgent}
      meta={item.note}
      metaWarn={item.noteWarn}
      metaIcon={<Glyph d={ICON.snooze} size={14} colour={item.noteWarn ? t.warn : t.ink3} width={2.3} />}
      leading={<Blob bot={bot} size={44} />}
      onPress={onPress}
    />
  );
}

function HistoryRow({ row, botId, onPress }: { row: HistoryRowModel; botId: string; onPress: () => void }) {
  const t = useTheme().tokens;
  const { botName } = row;
  const bot = useMemo(() => botLook({ botId, botName }), [botId, botName]);
  const colour = row.tone === "ok" ? t.ok : row.tone === "bad" ? t.danger : t.ink2;
  return (
    <Row
      title={botName}
      subtitle={row.question}
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
    />
  );
}

const WARN = "M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01";

/** `.flock`: the bots' blobs at 26 dp, 4 dp apart, and how many can page him. */
function Flock({ bots }: { bots: readonly KnownBot[] }) {
  const t = useTheme().tokens;
  return (
    <View style={styles.flock} accessible accessibilityLabel={flockText(bots.length)}>
      {bots.map((bot) => (
        <FlockBlob key={bot.botName} bot={bot} />
      ))}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.flockText, { color: t.ink3 }]}>
        {flockText(bots.length)}
      </Text>
    </View>
  );
}

function FlockBlob({ bot }: { bot: KnownBot }) {
  const { botId, botName } = bot;
  const look = useMemo(() => botLook({ botId, botName }), [botId, botName]);
  return <Blob bot={look} size={26} />;
}

/** H2: what to run on a computer, and Pair a bot (the words of O4, "Bring in your first bot"). */
function NoBots({ onPairBot }: { onPairBot: () => void }) {
  const t = useTheme().tokens;
  return (
    <View>
      <HeroText left title="Bring in your first bot" body="On a computer signed in to Puck, run:" />
      <View style={[styles.code, { backgroundColor: t.fill }]}>
        <Text selectable style={[styles.command, { color: t.ink }]}>
          {COMMAND}
        </Text>
        <CopyIcon colour={t.ink2} />
      </View>
      <Caption>The request shows up here on its own. You'll check a six-digit code and approve it.</Caption>
      <View style={styles.pair}>
        <Btn label="Pair a bot" variant="primary" onPress={onPairBot} />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------- connected */

export interface ConnectedH1HomeProps {
  /** This install's client id; null on the legacy device path (no lists then); undefined while it loads. */
  clientId: string | null | undefined;
  /** `usePushRegistration`: false when notifications are off. */
  notifications: boolean | null;
  /** `useFullScreenAccess().allowed`. */
  fullScreenAllowed: boolean | null;
  onAllowFullScreen: () => void;
  onOpenNeed: (item: NeedItem) => void;
  onGoThroughAll: () => void;
  onOpenAlert: (questionId: string) => void;
  onBots: () => void;
  onSettings: () => void;
  onPairBot: () => void;
  footer?: ReactNode;
}

/** A clock that ticks every 30 s, so "Back in 10 min" and "2 min ago" keep up. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** The phone's own states behind the health banners, read now and again each time the app is back in front. */
function useHealthBanners(input: {
  notifications: boolean | null;
  fullScreenAllowed: boolean | null;
}): { banners: BannerId[]; fix: (id: BannerId) => void } {
  const online = useOnline();
  const [notificationsOff, setNotificationsOff] = useState(input.notifications === false);
  const [dndAccess, setDndAccess] = useState<boolean | null>(() => hasDndAccess());
  const [bypassOn, setBypassOn] = useState(false);

  useEffect(() => {
    if (input.notifications === false) setNotificationsOff(true);
  }, [input.notifications]);

  const refresh = useCallback(async () => {
    setDndAccess(hasDndAccess());
    try {
      setBypassOn(dndBypassActive(await loadLocalSettings()));
      // Only once the push setup has looked (`notifications` is null before that, and on a build with no module).
      if (input.notifications !== null) setNotificationsOff(!(await readNotificationRowState()).granted);
    } catch (error) {
      console.error(readableError(error));
    }
  }, [input.notifications]);

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const fix = useCallback(
    (id: BannerId) => {
      void (async () => {
        try {
          if (id === "notifications") {
            if ((await readNotificationRowState()).canAskAgain) await ensureNotificationPermission();
            else await Linking.openSettings();
          } else if (id === "dnd") {
            await openDndAccessSettings();
          }
        } catch (error) {
          console.error(readableError(error));
        }
        await refresh();
      })();
    },
    [refresh],
  );

  const banners = healthBanners({
    notificationsOff,
    fullScreenOff: input.fullScreenAllowed === false,
    dndOff: dndAccess === false && bypassOn,
    offline: !online,
  });
  return { banners, fix };
}

export function ConnectedH1Home(props: ConnectedH1HomeProps) {
  const { clientId } = props;
  const now = useNow();
  const health = useHealthBanners({ notifications: props.notifications, fullScreenAllowed: props.fullScreenAllowed });

  const waiting = useQuery(anyApi.alerts.waiting, clientId ? { clientId } : "skip") as WaitingAlert[] | undefined;
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

  const queuedKey = (waiting ?? []).map((alert) => (isQueuedLocally(alert.questionId) ? alert.questionId : "")).join("|");
  const needs = useMemo(() => {
    if (!waiting) return clientId === null ? [] : undefined;
    const queuedIds = new Set(queuedKey.split("|").filter(Boolean));
    return needsYou(waiting, { now, queuedIds });
  }, [waiting, clientId, now, queuedKey]);

  const bots = useMemo(() => knownBots(waiting ?? [], history), [waiting, history]);
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
  const noBots =
    Boolean(clientId) &&
    isNoBotsYet({
      waiting,
      history: status === "LoadingFirstPage" ? undefined : history,
      historyDone: status === "Exhausted",
    });

  return (
    <H1Home
      banners={health.banners}
      onBanner={(id) => (id === "fullScreen" ? props.onAllowFullScreen() : health.fix(id))}
      needs={needs}
      history={status === "LoadingFirstPage" ? undefined : history}
      historyStatus={historyStatus}
      onLoadMore={onLoadMore}
      bots={bots}
      noBots={noBots}
      now={now}
      onOpenNeed={props.onOpenNeed}
      onGoThroughAll={props.onGoThroughAll}
      onOpenAlert={props.onOpenAlert}
      onBots={props.onBots}
      onSettings={props.onSettings}
      onPairBot={props.onPairBot}
      footer={props.footer}
    />
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 28 },
  /** `.hdr{height:56px; padding:0 14px 0 22px}` */
  header: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 22,
    paddingRight: 14,
  },
  /** `.brand{gap:9px; font-size:22px; font-weight:900; letter-spacing:-.01em}` */
  brand: { flexDirection: "row", alignItems: "center", gap: 9 },
  brandText: { fontFamily: fontFamily.black, fontSize: 22, fontWeight: "900", letterSpacing: 22 * -0.01 },
  icons: { flexDirection: "row" },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  /** `.sect{padding:22px 22px 6px}` */
  section: {
    fontFamily: fontFamily.black,
    fontSize: 12.5,
    fontWeight: "900",
    letterSpacing: 12.5 * 0.08,
    textTransform: "uppercase",
    paddingTop: 22,
    paddingHorizontal: 22,
    paddingBottom: 6,
  },
  /** `.needs{gap:10px; padding:2px 16px 0}` */
  needs: { gap: 10, paddingTop: 2, paddingHorizontal: 16 },
  /** The "Go through all" wrapper: `padding:12px 16px 0`. */
  all: { paddingTop: 12, paddingHorizontal: 16 },
  /** `.clear{padding:34px 22px 12px}` */
  clear: { paddingTop: 34, paddingHorizontal: 22, paddingBottom: 12 },
  clearTitle: { fontFamily: fontFamily.black, fontSize: 26, fontWeight: "900", letterSpacing: 26 * -0.01 },
  clearBody: { fontFamily: fontFamily.semiBold, fontSize: 15.5, fontWeight: "600", marginTop: 6 },
  /** `.flock{gap:4px; margin-top:16px}`, its text `margin-left:8px` */
  flock: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 16 },
  flockText: { fontFamily: fontFamily.bold, fontSize: 13.5, fontWeight: "700", marginLeft: 8 },
  more: { paddingTop: 16, paddingHorizontal: 16 },
  pair: { paddingTop: 22, paddingHorizontal: 20 },
  code: {
    marginHorizontal: 22,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  command: { fontFamily: "monospace", fontWeight: "700", fontSize: 14.5, flexShrink: 1 },
});
