/**
 * B1 Bots: every paired bot in its colour, with its name, when it last paged him, how many of its
 * alerts are waiting, and a muted marker; a request waiting for approval at the top ("Wants to page
 * you"); and Pair a bot, which opens the pairing flow (B3). Prototype: `SCREENS.bots` and `rowHTML`
 * (`vault/Projects/Puck/mockups/Puck prototype.html`); `App screens.md` B1.
 *
 * `B1Bots` only draws: it is given the list and callbacks. `bots` is undefined while it loads.
 */
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  botBlob,
  botTestId,
  lastPagedText,
  mutedLabel,
  sortBots,
  waitingTag,
  type BotListItem,
} from "../botsModel";
import { formatCode, fromText, requestLook, type PairingRequest } from "../pairingModel";
import { ICON, Glyph } from "../ui/AlertFrame";
import { Blob } from "../ui/Blob";
import { Btn } from "../ui/Btn";
import { Row } from "../ui/Row";
import { useTheme } from "../ui/theme";
import { fontFamily } from "../ui/tokens";
import { OnboardingFrame } from "../onboarding/parts";
import { MAX_FONT_SCALE, NavBar } from "./PairingParts";

export interface B1BotsProps {
  /** The paired bots; undefined while they load. */
  bots: readonly BotListItem[] | undefined;
  /** Requests waiting for approval, shown first. */
  pairings?: readonly PairingRequest[];
  now: number;
  onOpenBot: (botId: string) => void;
  onOpenPairing?: (botId: string) => void;
  /** "Pair a bot": B3. */
  onPair: () => void;
  onBack: () => void;
}

export function B1Bots({ bots, pairings = [], now, onOpenBot, onOpenPairing, onPair, onBack }: B1BotsProps) {
  const t = useTheme().tokens;
  const sorted = useMemo(() => (bots === undefined ? [] : sortBots(bots)), [bots]);
  const empty = bots !== undefined && bots.length === 0 && pairings.length === 0;

  return (
    <OnboardingFrame>
      <NavBar title="Bots" onBack={onBack} backTestID="back" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {pairings.length > 0 ? (
          <>
            <Section label="Wants to page you" />
            {pairings.map((request) => (
              <PairingRow key={request.botId} request={request} onPress={() => onOpenPairing?.(request.botId)} />
            ))}
          </>
        ) : null}

        {empty ? (
          <View style={styles.empty} testID="bots-empty">
            <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.emptyTitle, { color: t.ink }]}>
              No bots yet
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.emptyBody, { color: t.ink2 }]}>
              On a computer signed in to Puck, run puck add sheldon --colour coral, then approve it here.
            </Text>
          </View>
        ) : null}

        {sorted.length > 0 ? (
          <>
            <Section label="Paired" />
            {sorted.map((bot) => (
              <BotRow key={bot.botId} bot={bot} now={now} onPress={() => onOpenBot(bot.botId)} />
            ))}
          </>
        ) : null}

        <View style={styles.pair}>
          <Btn
            label="Pair a bot"
            variant="line"
            onPress={onPair}
            testID="pair-bot"
          />
        </View>
      </ScrollView>
    </OnboardingFrame>
  );
}

function Section({ label }: { label: string }) {
  const t = useTheme().tokens;
  return (
    <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.section, { color: t.ink3 }]}>
      {label}
    </Text>
  );
}

function BotRow({ bot, now, onPress }: { bot: BotListItem; now: number; onPress: () => void }) {
  const t = useTheme().tokens;
  const look = useMemo(() => botBlob(bot), [bot]);
  const muted = mutedLabel(bot.mutedUntil, now);
  const waiting = waitingTag(bot.waitingCount);
  return (
    <Row
      title={bot.name}
      subtitle={lastPagedText(bot.lastAlertAt, now)}
      tag={waiting ? { label: waiting.toUpperCase() } : undefined}
      detail={muted ?? undefined}
      detailIcon={muted ? <Glyph d={ICON.snooze} size={14} colour={t.ink2} width={2.3} /> : undefined}
      leading={<Blob bot={look} size={40} />}
      chevron
      onPress={onPress}
      testID={botTestId("bot-row", bot.name)}
    />
  );
}

function PairingRow({ request, onPress }: { request: PairingRequest; onPress: () => void }) {
  const look = useMemo(() => requestLook(request), [request]);
  return (
    <Row
      title={request.name}
      subtitle={`Pairing request from ${fromText(request.addedFrom)}`}
      detail={`Review and approve · code ${formatCode(request.pairingCode)}`}
      leading={<Blob bot={look} size={40} />}
      chevron
      onPress={onPress}
      testID={`pairing-row-${request.botId}`}
    />
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 28 },
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
  empty: { paddingTop: 34, paddingHorizontal: 22 },
  emptyTitle: { fontFamily: fontFamily.black, fontSize: 26, fontWeight: "900", letterSpacing: 26 * -0.01 },
  emptyBody: { fontFamily: fontFamily.semiBold, fontSize: 15.5, fontWeight: "600", marginTop: 6, lineHeight: 15.5 * 1.45 },
  /** `padding:18px 20px 0` */
  pair: { paddingTop: 18, paddingHorizontal: 20 },
});
