/**
 * H1 Home: the calm place he lands when nothing is paging him, and the list of everything that has.
 * Also H2 (no bots yet) and H3 (health banners). Prototype: `SCREENS.home`, `rowHTML`, `.hdr`,
 * `.sect`, `.needs`, `.clear` (`vault/Projects/Puck/mockups/Puck prototype.html`);
 * `App screens.md` H1, H2, H3; `User journeys.md` J10, J12.
 *
 * Top to bottom (each only when it has something):
 * - the header: the Puck wordmark with its blob, and the Archive, Bots and Settings icons;
 * - H3 banners, most serious first (`healthBanners` in `homeModel.ts`);
 * - H2 in place of the empty sections when no bot has ever paged him;
 * - "Needs you": a `NeedCard` per waiting alert, and "Go through all N" (two or more that can be
 *   answered from a stack);
 * - "Working now": a `LiveCard` per running task (`WorkingNow`), hidden when none;
 * - "All quiet": a nearly blank page with the Puck blob asleep and one line, when nothing needs him;
 * The history (by day, "Load more", the alert detail) is not on Home: the Archive icon in the header
 * opens the Archive screen (`Archive.tsx`).
 *
 * `H1Home` only draws: it is given its data and callbacks, so the dev sample route can show it with
 * no backend. `ConnectedH1Home` reads `alerts.waiting` and `alerts.history` from Convex and works
 * out the banners from the phone's real states.
 */
import { clientApi } from "@puck/client";
import { useQuery } from "convex/react";
import { hasDndAccess } from "puck-full-screen";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { AppState, Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../ui/Text";
import Svg, { Circle, Path } from "react-native-svg";
import { isQueuedLocally } from "../answerQueue";
import {
  BANNER_COPY,
  dndBypassActive,
  ALL_QUIET_BODY,
  healthBanners,
  needsTitle,
  goThroughLabel,
  needsYou,
  stackableCount,
  type BannerId,
  type HistoryRowModel,
  type NeedItem,
} from "../homeModel";
import { loadLocalSettings } from "../localSettings";
import { formatCode, fromText, requestLook, type PairingRequest } from "../pairingModel";
import type { LiveActivity } from "../liveCardModel";
import { useBots } from "../useBots";
import { useLiveActivities } from "../useLiveActivities";
import { usePairingRequests } from "../usePairingRequests";
import { openDndAccessSettings } from "../onboarding/dndAccess";
import { ensureNotificationPermission, readNotificationRowState } from "../onboarding/notificationSetup";
import { Caption, CopyIcon, HeroText, OnboardingFrame } from "../onboarding/parts";
import { readableError } from "../session";
import { ageLabel, Glyph, ICON } from "../ui/AlertFrame";
import { Banner } from "../ui/Banner";
import { Blob } from "../ui/Blob";
import { RestingBlob } from "../ui/RestingBlob";
import { useBotLook } from "../ui/useBotLook";
import { Btn } from "../ui/Btn";
import { NeedCard } from "../ui/NeedCard";
import { Row } from "../ui/Row";
import { useTheme } from "../ui/theme";
import { fontFamily } from "../ui/tokens";
import { PUCK_HOME_BLOB } from "../ui/puckBrandBlob";
import { useOnline } from "./A10Offline";
import { WorkingNow } from "./WorkingNow";

const MAX_FONT_SCALE = 1.3;
const COMMAND = "puck add sheldon --colour coral";

/* ----------------------------------------------------------------------- the screen */

export interface H1HomeProps {
  /** The banners to show, in order. */
  banners: readonly BannerId[];
  onBanner: (id: BannerId) => void;
  /** The "Needs you" cards; undefined while they load. */
  needs: readonly NeedItem[] | undefined;
  /** H2: nothing has ever paged him. */
  noBots: boolean;
  /** Now, so the ages and the day groups follow the clock. */
  now: number;
  /** A tap on a "Needs you" card. */
  onOpenNeed: (item: NeedItem) => void;
  /** "Go through all N". */
  onGoThroughAll: () => void;
  /** A tap on the Archive icon in the header: the Archive screen. */
  onOpenArchive: () => void;
  onBots: () => void;
  onSettings: () => void;
  /** Open pairing requests (P6): PAIRING cards, first in "Needs you". */
  pairings?: readonly PairingRequest[];
  /** A tap on a PAIRING card: B4 for that bot. */
  onOpenPairing?: (botId: string) => void;
  /** Running tasks (H5): "Working now", below Needs you; hidden when none. */
  live?: readonly LiveActivity[];
  /** A tap on a card whose task gave a link. */
  onOpenLive?: (activity: LiveActivity) => void;
  /** Under everything: sign out, the dev links. */
  footer?: ReactNode;
}

export function H1Home(props: H1HomeProps) {
  const { banners, onBanner, needs, now } = props;
  const pairings = props.pairings ?? [];
  // A waiting pairing request is the first bot coming in: H2's "run this command" has done its job.
  const noBots = props.noBots && pairings.length === 0;
  const t = useTheme().tokens;
  const stackable = needs ? stackableCount(needs) : 0;
  const live = (props.live?.length ?? 0) > 0;
  const allClear = !noBots && needs !== undefined && needs.length === 0 && pairings.length === 0 && !live;
  const needCount = (needs?.length ?? 0) + pairings.length;

  return (
    <OnboardingFrame>
      <Header onArchive={props.onOpenArchive} onBots={props.onBots} onSettings={props.onSettings} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={allClear ? styles.scrollFill : styles.scroll}>
        {banners.map((id) => (
          <Banner
            key={id}
            message={BANNER_COPY[id].message}
            action={BANNER_COPY[id].action ? { label: BANNER_COPY[id].action!, onPress: () => onBanner(id) } : undefined}
          />
        ))}

        {noBots ? <NoBots /> : null}

        {needCount > 0 ? (
          <>
            <Section label={needsTitle(needCount)} />
            <View style={styles.needs}>
              {/* Pairing requests (PAIRING cards) go first in this list. */}
              {pairings.map((request) => (
                <PairingRow key={request.botId} request={request} onPress={() => props.onOpenPairing?.(request.botId)} />
              ))}
              {(needs ?? []).map((item) => (
                <NeedRow key={item.questionId} item={item} now={now} onPress={() => props.onOpenNeed(item)} />
              ))}
            </View>
            {needs && stackable > 1 ? (
              <View style={styles.all}>
                <Btn label={goThroughLabel(stackable, needs.length)} variant="line" onPress={props.onGoThroughAll} />
              </View>
            ) : null}
          </>
        ) : null}

        <WorkingNow activities={props.live} now={now} onOpen={props.onOpenLive} />

        {allClear ? (
          <View style={styles.clear}>
            <RestingBlob />
            <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.clearTitle, { color: t.ink }]}>
              All quiet
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.clearBody, { color: t.ink2 }]}>
              {ALL_QUIET_BODY}
            </Text>
          </View>
        ) : null}

        {props.footer}
      </ScrollView>
    </OnboardingFrame>
  );
}

/* ------------------------------------------------------------------------- parts */

/** `.hdr`: 56 dp high, the wordmark on the left, the two icon buttons on the right. */
function Header({ onArchive, onBots, onSettings }: { onArchive: () => void; onBots: () => void; onSettings: () => void }) {
  const t = useTheme().tokens;
  return (
    <View style={styles.header}>
      <View style={styles.brand} accessible accessibilityRole="header" accessibilityLabel="Puck">
        <Blob bot={PUCK_HOME_BLOB} size={28} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.brandText, { color: t.ink }]}>
          Puck
        </Text>
      </View>
      <View style={styles.icons}>
        <IconButton label="Archive" onPress={onArchive} testID="archive-button">
          <Svg width={23} height={23} viewBox="0 0 24 24">
            <Path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" {...iconStroke(t.ink)} />
            <Path d="M3.5 4.4v4.3h4.3" {...iconStroke(t.ink)} />
            <Path d="M12 7.8V12l2.9 1.8" {...iconStroke(t.ink)} />
          </Svg>
        </IconButton>
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
function IconButton({
  label,
  onPress,
  children,
  testID,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
  testID?: string;
}) {
  const t = useTheme().tokens;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.iconButton, pressed ? { backgroundColor: t.fill } : null]}
    >
      {children}
    </Pressable>
  );
}

/** `.sect`: 12.5 / 900, upper case, wide tracking, in `ink3`. */
export function Section({ label }: { label: string }) {
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
  const bot = useBotLook({ botId, botName });
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
      leading={<Blob bot={bot} size={44} ring={t.avatarRing} />}
      onPress={onPress}
    />
  );
}

/** A PAIRING card: `needs.push(...)` for `S.pending` in the prototype's `SCREENS.home`. */
function PairingRow({ request, onPress }: { request: PairingRequest; onPress: () => void }) {
  const t = useTheme().tokens;
  const look = useMemo(() => requestLook(request), [request]);
  return (
    <NeedCard
      bot={look}
      name={request.name}
      question="Wants to page you"
      tag={{ label: "PAIRING" }}
      meta={`From ${fromText(request.addedFrom)} · check code ${formatCode(request.pairingCode)}`}
      leading={<Blob bot={look} size={44} ring={t.avatarRing} />}
      onPress={onPress}
    />
  );
}

export function HistoryRow({
  row,
  botId,
  onPress,
  testID,
}: {
  row: HistoryRowModel;
  botId: string;
  onPress: () => void;
  testID?: string;
}) {
  const t = useTheme().tokens;
  const { botName } = row;
  const bot = useBotLook({ botId, botName });
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
      testID={testID}
    />
  );
}

const WARN = "M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01";

/**
 * H2: what to run on a computer (the words of O4, "Bring in your first bot"). No button: the request
 * shows up here on its own, and pairing from the app is on the Bots screen.
 */
function NoBots() {
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
      <Caption>
        The request shows up here on its own. You'll check a six-digit code and approve it. You can also pair from Bots, at the top.
      </Caption>
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
  onOpenArchive: () => void;
  onBots: () => void;
  onSettings: () => void;
  /** A tap on a PAIRING card: B4 for that bot. */
  onOpenPairing?: (botId: string) => void;
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
  const pairings = usePairingRequests(clientId);
  const live = useLiveActivities(clientId);

  const waiting = useQuery(clientApi.alerts.waiting, clientId ? { clientId } : "skip");

  const queuedKey = (waiting ?? []).map((alert) => (isQueuedLocally(alert.questionId) ? alert.questionId : "")).join("|");
  const needs = useMemo(() => {
    if (!waiting) return clientId === null ? [] : undefined;
    const queuedIds = new Set(queuedKey.split("|").filter(Boolean));
    return needsYou(waiting, { now, queuedIds });
  }, [waiting, clientId, now, queuedKey]);

  // "No bots yet" comes from the paired bots (`bots.list`); the legacy path with no client id has no list.
  const botList = useBots(clientId);
  const noBots = Boolean(clientId) && botList !== undefined && botList.length === 0;

  return (
    <H1Home
      banners={health.banners}
      onBanner={(id) => (id === "fullScreen" ? props.onAllowFullScreen() : health.fix(id))}
      needs={needs}
      noBots={noBots}
      now={now}
      onOpenNeed={props.onOpenNeed}
      onGoThroughAll={props.onGoThroughAll}
      onOpenArchive={props.onOpenArchive}
      onBots={props.onBots}
      onSettings={props.onSettings}
      pairings={pairings ?? []}
      onOpenPairing={props.onOpenPairing}
      live={live}
      onOpenLive={(activity) => {
        if (activity.link) void Linking.openURL(activity.link.url).catch((error: unknown) => console.error(readableError(error)));
      }}
      footer={props.footer}
    />
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 28 },
  /** `.hdr{height:56px; padding:0 14px 0 22px}` */
  header: {
    minHeight: 56,
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
  /** All quiet: the scroll fills the screen, and the footer (the dev links) stays at the bottom. */
  scrollFill: { flexGrow: 1, paddingBottom: 28 },
  /** The blob, the title and the line sit in the middle of the empty space, a little above centre. */
  clear: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 36, paddingBottom: 72 },
  clearTitle: {
    fontFamily: fontFamily.black,
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: 28 * -0.01,
    marginTop: 22,
    textAlign: "center",
  },
  clearBody: { fontFamily: fontFamily.semiBold, fontSize: 16, fontWeight: "600", marginTop: 8, textAlign: "center" },
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
