import { StyleSheet, View } from "react-native";
import { puckColors } from "../theme/puckTheme";

export function OnboardingProgress({ index, total }: { index: number; total: number }) {
  return (
    <View style={styles.row}>
      {Array.from({ length: total }, (_, step) => (
        <View key={step} style={[styles.dot, step <= index ? styles.dotOn : null, step === index ? styles.dotCurrent : null]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    marginBottom: 22,
    marginTop: 8,
  },
  dot: {
    backgroundColor: "rgba(60, 36, 28, 0.16)",
    borderRadius: 99,
    height: 8,
    width: 8,
  },
  dotOn: {
    backgroundColor: puckColors.coral,
  },
  dotCurrent: {
    transform: [{ scale: 1.25 }],
  },
});
