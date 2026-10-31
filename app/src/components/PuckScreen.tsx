import { LinearGradient } from "expo-linear-gradient";
import { type ReactNode } from "react";
import { SafeAreaView, StyleSheet, View, type ViewStyle } from "react-native";
import { puckColors } from "../theme/puckTheme";

export function PuckScreen({
  children,
  center = false,
  style,
}: {
  children: ReactNode;
  center?: boolean;
  style?: ViewStyle;
}) {
  return (
    <LinearGradient colors={[puckColors.paperTop, puckColors.paper, puckColors.paperGlow]} style={styles.root}>
      <SafeAreaView style={[styles.safe, center ? styles.center : null, style]}>{children}</SafeAreaView>
      <View style={styles.homeIndicator} pointerEvents="none">
        <View style={styles.pill} />
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  safe: {
    flex: 1,
    paddingHorizontal: 26,
    paddingBottom: 12,
  },
  center: {
    justifyContent: "center",
  },
  homeIndicator: {
    alignItems: "center",
    paddingBottom: 10,
  },
  pill: {
    backgroundColor: "rgba(60, 36, 28, 0.28)",
    borderRadius: 99,
    height: 5,
    width: 128,
  },
});
