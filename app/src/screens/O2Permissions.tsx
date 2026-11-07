/**
 * O2 Permissions: three rows (notifications, show over the lock screen, get through Do Not
 * Disturb), each with its own button, ticking when the person comes back to the app.
 * Prototype: `SCREENS.perms` and the `.perm` CSS. Continue is always available.
 *
 * Do Not Disturb access has no JS check in our dependencies, so that row ticks as "asked" when
 * the person returns from the system screen, whether or not they turned it on.
 */
import { anyApi } from "convex/server";
import { useConvex } from "convex/react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Pressable, StyleSheet, View } from "react-native";
import { Text } from "../ui/Text";
import { canUseFullScreenIntent, hasDndAccess } from "puck-full-screen";
import { syncClientFullScreen, syncClientPushToken } from "../clientAuth";
import { openDndAccessSettings } from "../onboarding/dndAccess";
import { openFullScreenSettings } from "../onboarding/fullScreenSetup";
import { ensureNotificationPermission, readNotificationRowState } from "../onboarding/notificationSetup";
import { BellIcon, CheckIcon, HeroText, MoonIcon, OnboardingFrame, ScreenIcon } from "../onboarding/parts";
import { readableError } from "../session";
import { Btn } from "../ui/Btn";
import { useTheme } from "../ui/theme";
import { Toast, useToast } from "../ui/Toast";
import { fontFamily } from "../ui/tokens";

interface NotificationState {
  granted: boolean;
  canAskAgain: boolean;
}

export function O2Permissions({ clientId, onContinue }: { clientId: string; onContinue: () => void }) {
  const t = useTheme().tokens;
  const client = useConvex();
  const toast = useToast();
  const [notification, setNotification] = useState<NotificationState>({ granted: false, canAskAgain: true });
  const [fullScreen, setFullScreen] = useState<boolean>(() => canUseFullScreenIntent());
  const [dndAsked, setDndAsked] = useState(false);
  // Real Do Not Disturb access, or null on a build without the native function.
  const [dnd, setDnd] = useState<boolean | null>(() => hasDndAccess());
  const dndLaunched = useRef(false);
  const previous = useRef<{ notification: boolean; fullScreen: boolean; dnd: boolean | null } | null>(null);

  const refresh = useCallback(async () => {
    const [nextNotification, nextFullScreen] = [await readNotificationRowState(), canUseFullScreenIntent()];
    const nextDnd = hasDndAccess();
    setNotification(nextNotification);
    setFullScreen(nextFullScreen);
    setDnd(nextDnd);
    const before = previous.current;
    previous.current = { notification: nextNotification.granted, fullScreen: nextFullScreen, dnd: nextDnd };
    const syncDnd = () => {
      if (nextDnd === null) return;
      client
        .mutation(anyApi.clients.setFlags, { clientId, dndAccess: nextDnd })
        .catch((error: unknown) => console.error(readableError(error)));
    };
    if (!before) {
      // First look: record the current state on the client row so an urgent alert can ring.
      syncClientFullScreen(client, clientId).catch((error: unknown) => console.error(readableError(error)));
      syncDnd();
      return;
    }
    if (nextDnd !== before.dnd) syncDnd();
    if (nextNotification.granted && !before.notification) {
      toast.show("Notifications on");
      syncClientPushToken(client, clientId).catch((error: unknown) => console.error(readableError(error)));
    }
    if (nextFullScreen && !before.fullScreen) toast.show("Full-screen alerts allowed");
    if (nextFullScreen !== before.fullScreen) {
      client
        .mutation(anyApi.clients.setFlags, { clientId, fullScreenAllowed: nextFullScreen })
        .catch((error: unknown) => console.error(readableError(error)));
    }
  }, [client, clientId, toast.show]);

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (dndLaunched.current) {
        dndLaunched.current = false;
        setDndAsked(true);
        if (hasDndAccess() !== false) toast.show("Do Not Disturb access allowed");
      }
      void refresh();
    });
    return () => subscription.remove();
  }, [refresh, toast.show]);

  async function allowNotifications() {
    try {
      if (!notification.canAskAgain) {
        await Linking.openSettings();
        return;
      }
      await ensureNotificationPermission();
    } catch (error) {
      console.error(readableError(error));
    }
    await refresh();
  }

  async function allowFullScreen() {
    try {
      await openFullScreenSettings();
    } catch (error) {
      console.error(readableError(error));
    }
    await refresh();
  }

  async function allowDnd() {
    try {
      dndLaunched.current = true;
      await openDndAccessSettings();
    } catch (error) {
      dndLaunched.current = false;
      console.error(readableError(error));
    }
  }

  return (
    <OnboardingFrame>
      <HeroText left paddingBottom={18} title="Let bots reach you" body="Three switches. You can change them later in Settings." />
      <PermRow
        icon={<BellIcon colour={t.ink} />}
        title="Notifications"
        body="So bots can page you when Puck is closed."
        on={notification.granted}
        action={notification.canAskAgain ? "Allow" : "Open settings"}
        onPress={() => void allowNotifications()}
      />
      <PermRow
        icon={<ScreenIcon colour={t.ink} />}
        title="Show over the lock screen"
        body="Alerts can cover the lock screen. Urgent ones ring longer and repeat."
        on={fullScreen}
        action="Allow"
        onPress={() => void allowFullScreen()}
      />
      <PermRow
        icon={<MoonIcon colour={t.ink} />}
        title="Get through Do Not Disturb"
        body="Bots can ask to ring through DND and silent mode. At first only urgent alerts may."
        on={dnd ?? dndAsked}
        action="Allow"
        onPress={() => void allowDnd()}
      />
      <View style={styles.spacer} />
      <View style={styles.bottom}>
        <Btn label="Continue" onPress={onContinue} />
      </View>
      <Toast message={toast.message} visible={toast.visible} />
    </OnboardingFrame>
  );
}

/** `.perm`: fill card, 38 dp icon tile, title and line, and a 36 dp pill button (`.pb`, `.pb.done`). */
function PermRow({
  icon,
  title,
  body,
  on,
  action,
  onPress,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  on: boolean;
  action: string;
  onPress: () => void;
}) {
  const t = useTheme().tokens;
  return (
    <View style={[styles.perm, { backgroundColor: t.fill }]}>
      <View style={[styles.tile, { backgroundColor: t.card }]}>{icon}</View>
      <View style={styles.text}>
        <Text style={[styles.title, { color: t.ink }]}>{title}</Text>
        <Text style={[styles.body, { color: t.ink2 }]}>{body}</Text>
      </View>
      {on ? (
        <View
          accessibilityLabel={`${title}: on`}
          style={[styles.pill, styles.pillDone, { backgroundColor: t.okbg }]}
        >
          <CheckIcon colour={t.ok} />
          <Text style={[styles.pillText, { color: t.ok }]}>On</Text>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${action}: ${title}`}
          onPress={onPress}
          style={[styles.pill, { backgroundColor: t.primary }]}
        >
          <Text style={[styles.pillText, { color: t.onprimary }]}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  perm: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    padding: 16,
    borderRadius: 18,
    marginHorizontal: 20,
    marginBottom: 10,
  },
  tile: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  text: { flex: 1 },
  title: { fontFamily: fontFamily.extraBold, fontSize: 16 },
  body: { fontFamily: fontFamily.semiBold, fontSize: 14, lineHeight: 14 * 1.35, marginTop: 3 },
  pill: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
  },
  pillDone: { flexDirection: "row", gap: 5 },
  pillText: { fontFamily: fontFamily.black, fontSize: 14 },
  spacer: { flex: 1 },
  bottom: { paddingHorizontal: 20, paddingBottom: 14 },
});
