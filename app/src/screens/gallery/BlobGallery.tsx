/**
 * Dev gallery section for the blob: the six sample bots live (96 dp) and still
 * (44 dp) in the current theme mode, buttons that fire each reaction on every
 * live blob, and a toggle that points the eyes left or right.
 * Render it inside each light, dark and night mode block.
 */
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Blob, type BlobHandle } from "../../ui/Blob";
import { SAMPLE_BOTS, type Offset, type ReactionName } from "../../ui/blobShapes";
import { useTheme } from "../../ui/theme";

const BOTS = Object.values(SAMPLE_BOTS);
const REACTION_NAMES: ReactionName[] = ["arrive", "squash", "leap", "droop", "hop"];

/** Focus offsets from the prototype's `wireSwipe()` (`look(big, +-4, 3)`). */
const LOOKS: { label: string; look: Offset | null }[] = [
  { label: "Look: off", look: null },
  { label: "Look: left", look: { x: -4, y: 3 } },
  { label: "Look: right", look: { x: 4, y: 3 } },
];

export function BlobGallery() {
  const { tokens } = useTheme();
  const refs = useRef<(BlobHandle | null)[]>([]);
  const [lookIndex, setLookIndex] = useState(0);
  const look = LOOKS[lookIndex]!;

  const fire = (name: ReactionName) => {
    for (const handle of refs.current) handle?.[name]();
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.grid}>
        {BOTS.map((bot, i) => (
          <View key={bot.name} style={styles.cell}>
            <Blob
              ref={(h) => {
                refs.current[i] = h;
              }}
              bot={bot}
              size={96}
              live
              look={look.look}
            />
            <View style={styles.stillRow}>
              <Blob bot={bot} size={44} still />
              <Text style={[styles.name, { color: tokens.ink2 }]} numberOfLines={1}>
                {bot.name}
              </Text>
            </View>
          </View>
        ))}
      </View>
      <View style={styles.buttons}>
        {REACTION_NAMES.map((name) => (
          <Pressable
            key={name}
            onPress={() => fire(name)}
            style={[styles.btn, { backgroundColor: tokens.fill2 }]}
            accessibilityRole="button"
          >
            <Text style={[styles.btnText, { color: tokens.ink }]}>{name}</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => setLookIndex((i) => (i + 1) % LOOKS.length)}
          style={[styles.btn, { backgroundColor: tokens.primary }]}
          accessibilityRole="button"
        >
          <Text style={[styles.btnText, { color: tokens.onprimary }]}>{look.label}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: 16 },
  cell: { width: "33.333%", alignItems: "center", gap: 6, paddingTop: 40 },
  stillRow: { alignItems: "center", gap: 2 },
  name: { fontSize: 12 },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  btn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  btnText: { fontSize: 14, fontWeight: "600" },
});
