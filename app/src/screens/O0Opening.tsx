/**
 * O0 Opening: the Puck blob arriving, nothing else. After about two seconds of waiting it adds
 * "Connecting…". Prototype: `SCREENS.splash` (a 96 dp live Puck blob with the `arrive` reaction).
 */
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Blob, type BlobHandle } from "../ui/Blob";
import { SAMPLE_BOTS } from "../ui/blobShapes";
import { useTheme } from "../ui/theme";
import { fontFamily } from "../ui/tokens";

const SLOW_MS = 2000;

export function O0Opening() {
  const t = useTheme().tokens;
  const blob = useRef<BlobHandle>(null);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    blob.current?.arrive();
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={[styles.screen, { backgroundColor: t.bg }]}>
      <Blob ref={blob} bot={SAMPLE_BOTS.puck} size={96} live />
      {slow ? (
        <Text accessibilityLiveRegion="polite" style={[styles.slow, { color: t.ink3 }]}>
          Connecting…
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center" },
  slow: { position: "absolute", bottom: 96, fontFamily: fontFamily.extraBold, fontSize: 15 },
});
