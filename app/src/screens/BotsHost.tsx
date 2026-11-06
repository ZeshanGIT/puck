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
import { muteUntil, type BotListItem, type MuteChoice } from "../botsModel";
import { openSoundSettings, type SoundKind } from "../botSoundSettings";
import {
  forgetBotBypass,
  loadLocalSettings,
  saveBotBypass,
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

export interface BotsSource {
  /** The paired bots; undefined while they load. */
  bots: readonly BotListItem[] | undefined;
  /** Local Do Not Disturb and silent-mode overrides, by bot id. */
  bypass: Readonly<Record<string, BotBypass>>;
  /** Mute until a time (epoch ms), or null to unmute. */
  mute: (botId: string, until: number | null) => Promise<void>;
  setColour: (botId: string, colour: string) => Promise<void>;
  setBypass: (botId: string, change: BotBypassChange) => Promise<void>;
  remove: (botId: string) => Promise<void>;
  /** Opens Android's sound settings; resolves false when it could not. */
  openSound: (kind: SoundKind) => Promise<boolean>;
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
        onSound={(kind) =>
          void source.openSound(kind).then((ok) => {
            if (!ok) toast.show("Couldn't open Android's sound settings");
          })
        }
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
  useEffect(() => {
    let cancelled = false;
    void loadLocalSettings().then((settings) => {
      if (!cancelled) setBypass(settings.bots);
    });
    return () => {
      cancelled = true;
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
      setBypass: async (botId, change) => {
        const next = await saveBotBypass(botId, change);
        setBypass(next.bots);
      },
      remove: async (botId) => {
        await removeMutation({ clientId: needClient(), botId });
        setBypass((await forgetBotBypass(botId)).bots);
      },
      openSound: openSoundSettings,
    };
  }, [clientId, bots, bypass, updateMutation, removeMutation]);

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
