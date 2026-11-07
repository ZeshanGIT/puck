/**
 * S3 Other clients: every phone and CLI session signed in as him, with a name and when it was last
 * seen; this phone is marked, the others have Remove (tap twice; the removed client stops getting
 * alerts and has to sign in again). Prototype: `SCREENS.clients` (`vault/Projects/Puck/mockups/Puck
 * prototype.html`); `App screens.md` S3.
 *
 * `S3Clients` only draws: `clients` is undefined while the list loads, and `onRemove` runs the
 * removal (its failure is the host's to show).
 */
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text, useLines } from "../ui/Text";
import { botTestId } from "../botsModel";
import { clientRows, type ClientItem, type ClientRowModel } from "../settingsModel";
import { OnboardingFrame } from "../onboarding/parts";
import { Group } from "../ui/Group";
import { useTheme } from "../ui/theme";
import { fontFamily } from "../ui/tokens";
import { TapTwiceGroup, useTapTwice } from "../ui/useTapTwice";
import { MAX_FONT_SCALE, NavBar } from "./PairingParts";
import { Caption, ErrorLine, IconTile } from "./SettingsParts";

export interface S3ClientsProps {
  clients: readonly ClientItem[] | undefined;
  thisClientId: string | null;
  now: number;
  /** The second tap of Remove on another client. */
  onRemove: (clientId: string) => void;
  /** The client being removed, so its row stays still. */
  removingId?: string | null;
  error?: string | null;
  onBack: () => void;
}

export function S3Clients({ clients, thisClientId, now, onRemove, removingId = null, error = null, onBack }: S3ClientsProps) {
  const rows = useMemo(() => (clients ? clientRows(clients, thisClientId, now) : []), [clients, thisClientId, now]);
  return (
    <OnboardingFrame>
      <NavBar title="Other clients" onBack={onBack} backTestID="back" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Caption>Every alert reaches all of these, unless a bot picks one.</Caption>
        {clients === undefined ? null : (
          <TapTwiceGroup>
            <View style={styles.group}>
              <Group>
                {rows.map((row) => (
                  <ClientRow key={row.id} row={row} busy={removingId === row.id} onRemove={() => onRemove(row.id)} />
                ))}
              </Group>
            </View>
          </TapTwiceGroup>
        )}
        <ErrorLine message={error} />
      </ScrollView>
    </OnboardingFrame>
  );
}

function ClientRow({ row, busy, onRemove }: { row: ClientRowModel; busy: boolean; onRemove: () => void }) {
  const t = useTheme().tokens;
  const arm = useTapTwice({ onConfirm: onRemove });
  const lines = useLines(1);
  return (
    <View style={styles.row} testID={botTestId("client-row", row.name)}>
      <IconTile icon={row.platform === "cli" ? "laptop" : "phone"} />
      <View style={styles.main}>
        <Text numberOfLines={lines} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: t.ink }]}>
          {row.name}
        </Text>
        <Text numberOfLines={lines} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: t.ink2 }]}>
          {row.subtitle}
        </Text>
      </View>
      {row.removable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={arm.armed ? `Tap again to remove ${row.name}` : `Remove ${row.name}`}
          disabled={busy}
          onPress={arm.press}
          hitSlop={8}
          testID={botTestId("client-remove", row.name)}
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.remove, { color: t.danger, opacity: busy ? 0.5 : 1 }]}>
            {arm.armed ? "Tap again" : "Remove"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 28 },
  group: { paddingTop: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, paddingHorizontal: 16 },
  main: { flex: 1, minWidth: 0 },
  name: { fontFamily: fontFamily.extraBold, fontSize: 15, fontWeight: "800" },
  sub: { fontFamily: fontFamily.bold, fontSize: 13.5, fontWeight: "700", marginTop: 3 },
  remove: { fontFamily: fontFamily.black, fontSize: 14.5, fontWeight: "900" },
});
