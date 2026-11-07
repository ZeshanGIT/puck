/**
 * S6 Sign out: a sheet over Settings. It says this phone stops receiving alerts until he signs in
 * again, and signs out on the second tap (Q26's "tap twice" for a step that is hard to undo).
 * Prototype: `openSheet("signout")`; `App screens.md` S6.
 *
 * What signing out does is the host's call (`onConfirm`); this file only asks.
 */
import { StyleSheet, View } from "react-native";
import { Btn } from "../ui/Btn";
import { Sheet, SheetText, SheetTitle } from "../ui/Sheet";

export function S6SignOutSheet({
  visible,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} testID="signout-sheet">
      <SheetTitle>Sign out?</SheetTitle>
      <SheetText>This phone stops receiving alerts until you sign in again.</SheetText>
      <View style={styles.buttons}>
        <Btn
          label="Sign out"
          variant="danger"
          tapTwice={{ onConfirm, armedLabel: "Tap again to sign out" }}
          testID="signout-confirm"
        />
        <Btn label="Cancel" variant="ghost" onPress={onClose} testID="signout-cancel" />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  buttons: { gap: 4 },
});
