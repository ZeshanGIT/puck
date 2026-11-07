/**
 * Pill and tag, from the prototype's `.pill`, `.pill.urgent` and `.tag`.
 */
import { type ReactNode } from "react";
import { View } from "react-native";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { fontFamily } from "./tokens";

export interface PillProps {
  children: ReactNode;
  /** Optional 14 dp icon before the text, such as the prototype's `ICON.alarm`. */
  icon?: ReactNode;
  urgent?: boolean;
}

/** `.pill`: 26 dp high, 13 radius, 13 / 800. Urgent uses the danger tones. */
export function Pill({ children, icon, urgent = false }: PillProps) {
  const t = useTheme().tokens;
  const colour = urgent ? t.danger : t.ink2;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: 6,
        minHeight: 26,
        paddingVertical: 3,
        paddingHorizontal: 11,
        borderRadius: 13,
        backgroundColor: urgent ? t.dangerbg : t.fill,
      }}
    >
      {icon}
      <Text style={{ color: colour, fontFamily: fontFamily.extraBold, fontSize: 13 }}>{children}</Text>
    </View>
  );
}

export interface TagProps {
  children: ReactNode;
  urgent?: boolean;
}

/** `.tag`: 20 dp high, 10 radius, 11.5 / 900, shown beside a name. */
export function Tag({ children, urgent = false }: TagProps) {
  const t = useTheme().tokens;
  return (
    <View
      style={{
        alignSelf: "center",
        justifyContent: "center",
        minHeight: 20,
        paddingHorizontal: 7,
        borderRadius: 10,
        backgroundColor: urgent ? t.dangerbg : t.fill2,
      }}
    >
      <Text
        style={{
          color: urgent ? t.danger : t.ink2,
          fontFamily: fontFamily.black,
          fontSize: 11.5,
          letterSpacing: 0.35,
        }}
      >
        {children}
      </Text>
    </View>
  );
}
