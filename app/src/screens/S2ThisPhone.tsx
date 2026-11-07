/**
 * S2 This phone: its name, when it registered, whether push is connected; Rename, and Remove this
 * phone (which leads to the sign-out sheet, S6). Prototype: `SCREENS.sphone` and `.kv`
 * (`vault/Projects/Puck/mockups/Puck prototype.html`); `App screens.md` S2.
 *
 * Rename opens a sheet with one text field. `S2ThisPhone` only draws: it is given the values and
 * callbacks; `onRename` resolves with an error message, or null when the name was saved.
 */
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Text } from "../ui/Text";
import { checkClientName, pushRow, registeredText, type ClientItem } from "../settingsModel";
import { OnboardingFrame } from "../onboarding/parts";
import { Btn } from "../ui/Btn";
import { Sheet, SheetText, SheetTitle } from "../ui/Sheet";
import { useTheme } from "../ui/theme";
import { fontFamily } from "../ui/tokens";
import { KvRow, KvText, MAX_FONT_SCALE, NavBar } from "./PairingParts";
import { ErrorLine } from "./SettingsParts";

export interface S2ThisPhoneProps {
  /** This phone's client row; undefined while it loads, null when the account has no row for it. */
  client: ClientItem | null | undefined;
  /** The names other clients already use, for the rename check. */
  otherNames: readonly string[];
  now: number;
  /** Saves a new name; resolves with a message to show, or null when saved. */
  onRename: (name: string) => Promise<string | null>;
  /** "Remove this phone": the sign-out sheet. */
  onRemove: () => void;
  onBack: () => void;
}

export function S2ThisPhone({ client, otherNames, now, onRename, onRemove, onBack }: S2ThisPhoneProps) {
  const t = useTheme().tokens;
  const [renaming, setRenaming] = useState(false);
  const push = pushRow(client?.hasPushToken);
  const pushColour = push.tone === "ok" ? t.ok : push.tone === "warn" ? t.warn : t.ink2;

  return (
    <OnboardingFrame>
      <NavBar title="This phone" onBack={onBack} backTestID="back" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={[styles.group, { backgroundColor: t.fill }]}>
          <KvRow label="Name" first>
            <Text testID="phone-name" numberOfLines={1} style={[styles.text, { color: t.ink2 }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {client ? client.name : client === null ? "Not on your account" : "…"}
            </Text>
          </KvRow>
          <KvRow label="Registered">
            <KvText>{client ? registeredText(client.createdAt, now) : "…"}</KvText>
          </KvRow>
          <KvRow label="Push">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.text, { color: pushColour }]} testID="phone-push">
              {client ? push.text : "…"}
            </Text>
          </KvRow>
        </View>
        <View style={styles.buttons}>
          <Btn label="Rename" variant="line" disabled={!client} onPress={() => setRenaming(true)} testID="phone-rename" />
          <View style={{ height: 10 }} />
          <Btn label="Remove this phone" variant="danger" onPress={onRemove} testID="phone-remove" />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: t.ink3 }]}>
            It signs this phone out. Sign in again to get alerts here.
          </Text>
        </View>
      </ScrollView>
      <RenameSheet
        visible={renaming}
        current={client?.name ?? ""}
        otherNames={otherNames}
        onSave={onRename}
        onClose={() => setRenaming(false)}
      />
    </OnboardingFrame>
  );
}

function RenameSheet({
  visible,
  current,
  otherNames,
  onSave,
  onClose,
}: {
  visible: boolean;
  current: string;
  otherNames: readonly string[];
  onSave: (name: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const t = useTheme().tokens;
  const [text, setText] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Start from the current name each time the sheet opens.
  useEffect(() => {
    if (visible) {
      setText(current);
      setError(null);
    }
  }, [visible, current]);

  async function save() {
    const check = checkClientName(text, otherNames);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    if (check.name === current) {
      onClose();
      return;
    }
    setBusy(true);
    const message = await onSave(check.name);
    setBusy(false);
    if (message) setError(message);
    else onClose();
  }

  return (
    <Sheet visible={visible} onClose={onClose} testID="rename-sheet">
      <KeyboardAvoidingView behavior="padding">
        <SheetTitle>Rename this phone</SheetTitle>
        <SheetText>Other clients and the alert details show this name.</SheetText>
        <TextInput
          maxFontSizeMultiplier={1.3}
          testID="rename-input"
          value={text}
          onChangeText={(next) => {
            setText(next);
            setError(null);
          }}
          onSubmitEditing={() => void save()}
          autoFocus
          maxLength={80}
          returnKeyType="done"
          autoCapitalize="words"
          accessibilityLabel="Name"
          placeholderTextColor={t.ink3}
          style={[styles.input, { backgroundColor: t.fill, color: t.ink, borderColor: error ? t.danger : t.line }]}
        />
        <ErrorLine message={error} />
        <View style={styles.sheetButtons}>
          <Btn label={busy ? "Saving…" : "Save"} disabled={busy} onPress={() => void save()} testID="rename-save" />
          <Btn label="Cancel" variant="ghost" onPress={onClose} testID="rename-cancel" />
        </View>
      </KeyboardAvoidingView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 28 },
  group: { marginTop: 4, marginHorizontal: 16, borderRadius: 18, overflow: "hidden" },
  text: { fontFamily: fontFamily.bold, fontSize: 15, fontWeight: "700", flexShrink: 1 },
  /** `padding:20px 20px 0` */
  buttons: { paddingTop: 20, paddingHorizontal: 20 },
  note: { fontFamily: fontFamily.semiBold, fontSize: 13.5, textAlign: "center", paddingTop: 10 },
  input: {
    minHeight: 56,
    borderRadius: 18,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    fontFamily: fontFamily.extraBold,
    fontSize: 17,
    fontWeight: "800",
  },
  sheetButtons: { paddingTop: 14, gap: 4 },
});
