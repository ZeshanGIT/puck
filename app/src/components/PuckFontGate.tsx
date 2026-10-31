import {
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  Nunito_900Black,
  useFonts,
} from "@expo-google-fonts/nunito";
import { type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { PuckBlob } from "./PuckBlob";
import { PuckScreen } from "./PuckScreen";
import { puckColors } from "../theme/puckTheme";

export function PuckFontGate({ children }: { children: ReactNode }) {
  const [loaded] = useFonts({
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
    Nunito_900Black,
  });

  if (!loaded) {
    return (
      <PuckScreen center>
        <PuckBlob size={120} mood="idle" />
        <View style={styles.loader}>
          <ActivityIndicator color={puckColors.coral} size="large" />
        </View>
      </PuckScreen>
    );
  }

  return children;
}

const styles = StyleSheet.create({
  loader: {
    marginTop: 28,
  },
});
