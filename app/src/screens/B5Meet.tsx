/**
 * B5 Meet the bot: a short moment that introduces the new bot as a character, after it is
 * approved. The bot in its colour, "Sheldon can page you now." Done goes back to wherever pairing
 * started. Prototype: `SCREENS.meet` (`vault/Projects/Puck/mockups/Puck prototype.html`);
 * `App screens.md` B5.
 */
import { useLayoutEffect, useRef } from "react";
import { StatusBar, StyleSheet, View } from "react-native";
import { Wash } from "../ui/AlertFrame";
import { Blob, type BlobHandle } from "../ui/Blob";
import type { BlobBot } from "../ui/blobShapes";
import { Btn } from "../ui/Btn";
import { useBotTheme, useTheme } from "../ui/theme";
import { HeroText } from "../onboarding/parts";

export function B5Meet({ bot, onDone }: { bot: BlobBot; onDone: () => void }) {
  const t = useTheme().tokens;
  const bt = useBotTheme(bot);
  const blob = useRef<BlobHandle>(null);
  // `blob(b,150,{live:true,cls:"hop"})`: the blob hops when the screen opens.
  useLayoutEffect(() => {
    blob.current?.hop();
  }, []);

  return (
    <View style={[styles.screen, { backgroundColor: t.bg }]}>
      <Wash colour={bt.botWash} night={false} />
      <View style={[styles.content, { paddingTop: (StatusBar.currentHeight ?? 24) + 8 }]}>
        <View style={styles.hero}>
          <Blob ref={blob} bot={bot} size={150} live />
          <HeroText title={`${bot.name} can page you now`} body="It'll look like this whenever it needs you." />
        </View>
        <View style={styles.bottom}>
          <Btn label="Done" onPress={onDone} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1 },
  hero: { flex: 1, justifyContent: "center", alignItems: "center" },
  /** `padding:0 20px 14px` */
  bottom: { paddingHorizontal: 20, paddingBottom: 14 },
});
