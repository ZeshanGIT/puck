/**
 * A quiet text link, the style the new screens use for one ("Open app settings" on the health
 * screen): 14.5 / 900 in `ink`, underlined. Colours come from `useTheme()`, the size follows the
 * phone's font size up to 130%.
 */
import { Pressable } from "react-native";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { fontFamily } from "./tokens";

export function TextLink({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  const t = useTheme().tokens;
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      hitSlop={8}
      testID={testID}
      style={{ alignSelf: "flex-start", paddingVertical: 8 }}
    >
      <Text
        style={{
          color: t.ink,
          fontFamily: fontFamily.black,
          fontSize: 14.5,
          fontWeight: "900",
          textDecorationLine: "underline",
          textDecorationColor: t.edge,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
