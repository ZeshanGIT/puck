/**
 * Runs the Bots screens: B1 (the list) and B2 (one bot), with Back from B2 to B1 and from B1 to
 * where it was opened (Home); the Android back gesture does the same. It takes a `BotsSource` (the
 * bots, and what changes them) so the same screens run on Convex (`ConnectedBotsHost`) and on fake
 * data in the dev gallery.
 *
 * What is stored where: mute and colour on the backend (`bots.update`), remove on the backend
 * (`bots.remove`), and the Do Not Disturb and silent-mode overrides on the phone (`localSettings.ts`).
 */
import { anyApi } from "convex/server";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BackHandler, StyleSheet, View } from "react-native";
import { ringtoneTitle } from "puck-full-screen";
import { chooseRingtone, resetBotSound, type SoundKind } from "../botSoundSettings";
import { muteUntil, type BotListItem, type MuteChoice } from "../botsModel";
import {
  DEFAULT_LOCAL_SETTINGS,
  forgetBotBypass,
  loadLocalSettings,
  saveBotBypass,
  subscribeLocalSettings,
  type LocalSettings,
  type BotBypass,
  type BotBypassChange,
  type BypassMode,
} from "../localSettings";
import { readableError } from "../session";
import type { PairingRequest } from "../pairingModel";
import { Toast, useToast } from "../ui/Toast";
import { usePairingRequests } from "../usePairingRequests";
import { useBots } from "../useBots";
import { B1Bots } from "./B1Bots";
import { B2Bot } from "./B2Bot";

/** A bot's own ringtone by name; null when it has none and follows the default. */
function ownRingtone(uri: string | undefined): string | null {
  return uri === undefined ? null : (ringtoneTitle(uri) ?? "Phone ringtone");
}

export interface BotsSource {
  /** The paired bots; undefined while they load. */
  bots: readonly BotListItem[] | undefined;
  /** Local Do Not Disturb and silent-mode overrides, by bot id. */
  bypass: Readonly<Record<string, BotBypass>>;
  /** Mute until a time (epoch ms), or null to unmute. */
  mute: (botId: string, until: number | null) => Promise<void>;
  setColour: (botId: string, colour: string) => Promise<void>;
  setShape: (botId: string, shape: string) => Promise<void>;
  setBypass: (botId: string, change: BotBypassChange) => Promise<void>;
  remove: (botId: string) => Promise<void>;
  /** Opens the ringtone picker for this bot's normal or urgent alerts and keeps the choice; resolves false when it could not open. */
  pickRingtone: (botId: string, kind: SoundKind) => Promise<boolean>;
  /** Makes the bot follow app settings again for this kind of alert (the ringtone and whether it repeats). */
  resetSound: (botId: string, kind: SoundKind) => Promise<void>;
  /** What Alert sounds says about repeating, which a bot follows unless it has its own. */
  appLoop: { normal: boolean; urgent: boolean };
  /** What Alert sounds says about full screen while the phone is in use, which a bot follows unless it has its own. */
  appFullScreen: { normal: boolean; urgent: boolean };
  /** What Alerts says about Do Not Disturb, silent mode and reminders, which a bot follows unless it has its own. */
  appBypass: { dnd: BypassMode; silent: BypassMode };
  appReminder: { normal: number; urgent: number };
}

/** Where the screens start. */
export type BotsStart = { kind: "list" } | { kind: "bot"; botId: string };

export interface BotsHostProps {
  source: BotsSource;
  start?: BotsStart;
  /** Requests waiting for approval, shown at the top of B1. */
  pairings?: readonly PairingRequest[];
  onOpenPairing?: (botId: string) => void;
  /** "Pair a bot" on B1: the pairing flow (B3). */
  onPair: () => void;
  /** Back from B1. */
  onClose: () => void;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function BotsHost({ source, start = { kind: "list" }, pairings, onOpenPairing, onPair, onClose }: BotsHostProps) {
  const now = useNow(30_000);
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(start.kind === "bot" ? start.botId : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { bots, bypass } = source;
  const bot = openId === null ? null : (bots ?? []).find((item) => item.botId === openId) ?? null;

  const back = useCallback(() => {
    setError(null);
    if (openId !== null) setOpenId(null);
    else onClose();
  }, [openId, onClose]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      back();
      return true;
    });
    return () => subscription.remove();
  }, [back]);

  // The bot he is looking at is gone from the list (removed on another phone): back to the list.
  useEffect(() => {
    if (openId !== null && bots !== undefined && bot === null && !busy) setOpenId(null);
  }, [openId, bots, bot, busy]);

  const run = useCallback(async (work: () => Promise<void>) => {
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(readableError(caught));
    }
  }, []);

  if (bot === null) {
    return (
      <View style={styles.fill}>
        <B1Bots
          bots={bots}
          pairings={pairings}
          now={now}
          onOpenBot={(botId) => setOpenId(botId)}
          onOpenPairing={onOpenPairing}
          onPair={onPair}
          onBack={back}
        />
        <Toast message={toast.message} visible={toast.visible} />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <B2Bot
        bot={bot}
        now={now}
        bypass={bypass[bot.botId]}
        busy={busy}
        error={error}
        onMute={(choice: MuteChoice) => void run(() => source.mute(bot.botId, muteUntil(choice, Date.now())))}
        onBypass={(which, mode: BypassMode | null) => void run(() => source.setBypass(bot.botId, { [which]: mode }))}
        onColour={(colour) => void run(() => source.setColour(bot.botId, colour))}
        onShape={(shape) => void run(() => source.setShape(bot.botId, shape))}
        onReminder={(kind, minutes) =>
          void run(() =>
            source.setBypass(bot.botId, kind === "urgent" ? { reminderMinutes: minutes } : { reminderMinutesNormal: minutes }),
          )
        }
        appBypass={source.appBypass}
        appReminder={source.appReminder}
        normalRingtone={ownRingtone(bypass[bot.botId]?.normalRingtone)}
        urgentRingtone={ownRingtone(bypass[bot.botId]?.urgentRingtone)}
        onRingtone={(kind) =>
          void source.pickRingtone(bot.botId, kind).then((ok) => {
            if (!ok) toast.show("Couldn't open the ringtone picker");
          })
        }
        appLoop={source.appLoop}
        appFullScreen={source.appFullScreen}
        onFullScreen={(kind, fullScreen) =>
          void run(() =>
            source.setBypass(bot.botId, kind === "urgent" ? { fullScreenUrgent: fullScreen } : { fullScreenNormal: fullScreen }),
          )
        }
        onLoop={(kind, loop) =>
          void run(() => source.setBypass(bot.botId, kind === "urgent" ? { loopUrgent: loop } : { loopNormal: loop }))
        }
        onResetSound={(kind) => void run(() => source.resetSound(bot.botId, kind))}
        onRemove={() => {
          const name = bot.name;
          setBusy(true);
          void run(async () => {
            await source.remove(bot.botId);
            setOpenId(null);
            toast.show(`${name} removed`);
          }).finally(() => setBusy(false));
        }}
        onBack={back}
      />
      <Toast message={toast.message} visible={toast.visible} />
    </View>
  );
}

/* ------------------------------------------------------------------- connected */

/** The Bots screens on Convex (`bots.list`, `bots.update`, `bots.remove`) and the phone's local settings. */
export function ConnectedBotsHost({
  clientId,
  start,
  onOpenPairing,
  onPair,
  onClose,
}: {
  clientId: string | null | undefined;
  start?: BotsStart;
  onOpenPairing?: (botId: string) => void;
  onPair: () => void;
  onClose: () => void;
}) {
  const bots = useBots(clientId);
  const pairings = usePairingRequests(clientId);
  const updateMutation = useMutation(anyApi.bots.update);
  const removeMutation = useMutation(anyApi.bots.remove);
  const [bypass, setBypass] = useState<Record<string, BotBypass>>({});
  const [appLoop, setAppLoop] = useState({ normal: false, urgent: false });
  const [appFullScreen, setAppFullScreen] = useState({ normal: false, urgent: false });
  const [appBypass, setAppBypass] = useState<{ dnd: BypassMode; silent: BypassMode }>({
    dnd: DEFAULT_LOCAL_SETTINGS.bypassDnd,
    silent: DEFAULT_LOCAL_SETTINGS.bypassSilent,
  });
  const [appReminder, setAppReminder] = useState({
    normal: DEFAULT_LOCAL_SETTINGS.reminderMinutesNormal,
    urgent: DEFAULT_LOCAL_SETTINGS.reminderMinutes,
  });
  useEffect(() => {
    let cancelled = false;
    const apply = (settings: LocalSettings) => {
      setBypass(settings.bots);
      setAppLoop({ normal: settings.loopNormal, urgent: settings.loopUrgent });
      setAppFullScreen({ normal: settings.fullScreenNormal, urgent: settings.fullScreenUrgent });
      setAppBypass({ dnd: settings.bypassDnd, silent: settings.bypassSilent });
      setAppReminder({ normal: settings.reminderMinutesNormal, urgent: settings.reminderMinutes });
    };
    void loadLocalSettings().then((settings) => {
      if (!cancelled) apply(settings);
    });
    // Every save (the ringtone picker saves on its own) shows at once.
    const unsubscribe = subscribeLocalSettings(apply);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const source = useMemo<BotsSource>(() => {
    const needClient = (): string => {
      if (!clientId) throw new Error("Sign in again to change a bot");
      return clientId;
    };
    return {
      bots: clientId === null ? [] : bots,
      bypass,
      mute: async (botId, until) => {
        await updateMutation({ clientId: needClient(), botId, mutedUntil: until });
      },
      setColour: async (botId, colour) => {
        await updateMutation({ clientId: needClient(), botId, colour });
      },
      setShape: async (botId, shape) => {
        await updateMutation({ clientId: needClient(), botId, shape });
      },
      setBypass: async (botId, change) => {
        const next = await saveBotBypass(botId, change);
        setBypass(next.bots);
      },
      remove: async (botId) => {
        await removeMutation({ clientId: needClient(), botId });
        setBypass((await forgetBotBypass(botId)).bots);
      },
      pickRingtone: (botId, kind) => chooseRingtone(kind, botId),
      resetSound: (botId, kind) => resetBotSound(botId, kind),
      appLoop,
      appFullScreen,
      appBypass,
      appReminder,
    };
  }, [clientId, bots, bypass, appLoop, appFullScreen, appBypass, appReminder, updateMutation, removeMutation]);

  return (
    <BotsHost
      source={source}
      start={start}
      pairings={pairings}
      onOpenPairing={onOpenPairing}
      onPair={onPair}
      onClose={onClose}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
