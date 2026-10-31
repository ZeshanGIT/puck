import { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { puckColors, puckFonts } from "../theme/puckTheme";

type Variant = "coral" | "ink" | "ghost";

export function PuckButton({
  label,
  onPress,
  disabled,
  variant = "coral",
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: Variant;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variant === "coral" ? styles.coral : null,
        variant === "ink" ? styles.ink : null,
        variant === "ghost" ? styles.ghost : null,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      <Text
        style={[
          styles.label,
          variant === "coral" ? styles.labelCoral : null,
          variant === "ink" ? styles.labelInk : null,
          variant === "ghost" ? styles.labelGhost : null,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function PuckTextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.linkWrap}>
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}

export function PuckKicker({ children }: { children: string }) {
  return <Text style={styles.kicker}>{children}</Text>;
}

export function PuckTitle({ children }: { children: string }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function PuckBody({ children }: { children: ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

export function PuckError({ children }: { children: string }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.error}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    borderRadius: 18,
    justifyContent: "center",
    minHeight: 64,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  coral: {
    backgroundColor: puckColors.coral,
    shadowColor: puckColors.lip,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 4,
  },
  ink: {
    backgroundColor: puckColors.inkButton,
  },
  ghost: {
    backgroundColor: puckColors.card,
    borderColor: puckColors.choiceBorder,
    borderWidth: 2,
    minHeight: 56,
    shadowColor: puckColors.choiceShadow,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  pressed: {
    shadowOffset: { width: 0, height: 0 },
    transform: [{ translateY: 6 }],
  },
  disabled: {
    opacity: 0.55,
  },
  label: {
    fontFamily: puckFonts.black,
    fontSize: 18,
    letterSpacing: 0.2,
  },
  labelCoral: {
    color: "#fff",
  },
  labelInk: {
    color: puckColors.paperTop,
    fontSize: 17,
  },
  labelGhost: {
    color: puckColors.ink,
    fontFamily: puckFonts.extraBold,
    fontSize: 17,
  },
  linkWrap: {
    alignItems: "center",
    marginTop: 16,
  },
  link: {
    color: puckColors.ink,
    fontFamily: puckFonts.extraBold,
    fontSize: 14,
    textDecorationLine: "underline",
  },
  kicker: {
    color: puckColors.accent,
    fontFamily: puckFonts.extraBold,
    fontSize: 14,
    letterSpacing: 0.4,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  title: {
    color: puckColors.ink,
    fontFamily: puckFonts.black,
    fontSize: 34,
    letterSpacing: -0.3,
    lineHeight: 38,
    marginBottom: 10,
  },
  body: {
    color: puckColors.ink,
    fontFamily: puckFonts.bold,
    fontSize: 17,
    lineHeight: 25,
    marginBottom: 18,
  },
  errorBox: {
    backgroundColor: "rgba(138, 47, 36, 0.08)",
    borderRadius: 14,
    marginBottom: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  error: {
    color: puckColors.error,
    fontFamily: puckFonts.bold,
    fontSize: 15,
    lineHeight: 21,
  },
});
