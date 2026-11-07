/**
 * Selectable chip, from the prototype's `.chip` and `.chip.on`. The selected
 * state changes the border and text as well as the fill, so it is not
 * shown by colour alone.
 */
import { Pressable } from "react-native";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { fontFamily } from "./tokens";

export interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}

/** `.chips` row members: 36 dp high, 18 radius, 14 / 800. */
export function Chip({ label, selected, onPress, testID }: ChipProps) {
  const t = useTheme().tokens;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      testID={testID}
      style={{
        minHeight: 36,
        paddingVertical: 4,
        justifyContent: "center",
        paddingHorizontal: 14,
        borderRadius: 18,
        borderWidth: 1.5,
        borderColor: selected ? t.ink : "transparent",
        backgroundColor: selected ? t.card : t.fill,
      }}
    >
      <Text
        style={{
          color: selected ? t.ink : t.ink2,
          fontFamily: fontFamily.extraBold,
          fontSize: 14,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
