/**
 * Dev-only design gallery. Renders the tokens, bot colours, type scale and radii
 * so they can be checked in light, dark and night. Reached only from the
 * `__DEV__` menu in Inbox and guarded in App.tsx.
 *
 * To add a component, append a `<Section title="...">` block inside each
 * mode block below (Light, Dark and, for bot-driven components, Night).
 * Plain React Native only: no native-backed libraries, so the dev client does
 * not need a rebuild.
 */
import { createContext, type ReactNode, useContext } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { PALETTE, botTheme, type BotThemeMode } from "../ui/botTheme";
import { ThemeProvider, type ThemeMode } from "../ui/theme";
import { BlobGallery } from "./gallery/BlobGallery";
import { BtnGallery } from "./gallery/BtnGallery";
import { RichTextGallery } from "./gallery/RichTextGallery";
import { SmallComponentsGallery } from "./gallery/SmallComponentsGallery";
import {
  darkTokens,
  fontFamily,
  lightTokens,
  radii,
  type TextStyleToken,
  type ThemeTokens,
  typeScale,
} from "../ui/tokens";

interface GalleryMode {
  tokens: ThemeTokens;
  bot: BotThemeMode;
}

const GalleryModeContext = createContext<GalleryMode>({ tokens: lightTokens, bot: {} });

function useGalleryMode(): GalleryMode {
  return useContext(GalleryModeContext);
}

/** A themed block: sets the tokens and bot mode for everything inside it. */
export function ModeBlock({
  title,
  tokens,
  bot,
  children,
}: {
  title: string;
  tokens: ThemeTokens;
  bot: BotThemeMode;
  children: ReactNode;
}) {
  const mode: ThemeMode = bot.night ? "night" : bot.dark ? "dark" : "light";
  return (
    <GalleryModeContext.Provider value={{ tokens, bot }}>
      <ThemeProvider mode={mode}>
        <View style={[styles.block, { backgroundColor: tokens.bg, borderColor: tokens.edge }]}>
          <Text style={[styles.blockTitle, { color: tokens.ink }]}>{title}</Text>
          {children}
        </View>
      </ThemeProvider>
    </GalleryModeContext.Provider>
  );
}

/** A titled group of components inside a mode block. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  const { tokens } = useGalleryMode();
  return (
    <View style={styles.section}>
      <Text style={[typeScale.sectionHeader, { color: tokens.ink2 }]}>{title}</Text>
      {children}
    </View>
  );
}

function Chip({
  label,
  value,
  fill,
  borderColor,
  labelColor,
  sample,
  sampleColor,
}: {
  label: string;
  value: string;
  fill: string;
  borderColor: string;
  labelColor: string;
  sample?: string;
  sampleColor?: string;
}) {
  return (
    <View style={styles.chip}>
      <View style={[styles.swatch, { backgroundColor: fill, borderColor }]}>
        {sample ? <Text style={[styles.sample, { color: sampleColor ?? labelColor }]}>{sample}</Text> : null}
      </View>
      <Text style={[styles.chipLabel, { color: labelColor }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.chipValue, { color: labelColor }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function TokenChips() {
  const { tokens } = useGalleryMode();
  return (
    <View style={styles.row}>
      {Object.entries(tokens).map(([name, value]) => (
        <Chip
          key={name}
          label={name}
          value={value}
          fill={value}
          borderColor={tokens.edge}
          labelColor={tokens.ink}
        />
      ))}
    </View>
  );
}

function BotChips() {
  const { tokens, bot } = useGalleryMode();
  return (
    <View style={styles.botList}>
      {PALETTE.map((entry) => {
        const t = botTheme({ colour: entry.name }, bot);
        return (
          <View key={entry.name} style={styles.botRow}>
            <Text style={[styles.botName, { color: tokens.ink }]}>{entry.name}</Text>
            <View style={styles.row}>
              <Chip label="bot" value={t.bot} fill={t.bot} borderColor={tokens.edge} labelColor={tokens.ink2} />
              <Chip
                label="botDeep"
                value={t.botDeep}
                fill={t.botDeep}
                borderColor={tokens.edge}
                labelColor={tokens.ink2}
              />
              <Chip
                label="botWash"
                value={t.botWash}
                fill={t.botWash}
                borderColor={tokens.edge}
                labelColor={tokens.ink2}
              />
              <Chip
                label="botTint"
                value={t.botTint}
                fill={t.botTint}
                borderColor={tokens.edge}
                labelColor={tokens.ink2}
              />
              <Chip
                label="onBot"
                value={t.onBot}
                fill={t.bot}
                borderColor={tokens.edge}
                labelColor={tokens.ink2}
                sample="Aa"
                sampleColor={t.onBot}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const typeRows: [string, TextStyleToken][] = [
  ["alertQuestion", typeScale.alertQuestion],
  ["stackQuestion", typeScale.stackQuestion],
  ["optionLabel", typeScale.optionLabel],
  ["optionDescription", typeScale.optionDescription],
  ["body", typeScale.body],
  ["sectionHeader", typeScale.sectionHeader],
];

function TypeScale() {
  const { tokens } = useGalleryMode();
  return (
    <View style={styles.typeList}>
      {typeRows.map(([name, style]) => (
        <View key={name} style={styles.typeRow}>
          <Text style={[styles.chipLabel, { color: tokens.ink2 }]}>
            {`${name} · ${style.fontSize} · ${style.fontWeight}`}
          </Text>
          <Text style={[style, { color: tokens.ink }]}>Aa Puck 0123 sample text</Text>
        </View>
      ))}
      {[typeScale.captionMinSize, typeScale.captionMaxSize].map((size) => (
        <View key={`caption-${size}`} style={styles.typeRow}>
          <Text style={[styles.chipLabel, { color: tokens.ink2 }]}>{`caption · ${size}`}</Text>
          <Text style={{ fontSize: size, fontFamily: fontFamily.semiBold, color: tokens.ink2 }}>
            Caption text sample, weights vary per element
          </Text>
        </View>
      ))}
    </View>
  );
}

function Radii() {
  const { tokens } = useGalleryMode();
  return (
    <View style={styles.row}>
      {Object.entries(radii).map(([name, value]) => (
        <View key={name} style={styles.radiusItem}>
          <View
            style={[
              styles.radiusBox,
              { borderRadius: value, backgroundColor: tokens.fill, borderColor: tokens.edge },
            ]}
          />
          <Text style={[styles.chipLabel, { color: tokens.ink }]}>{`${name} ${value}`}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Component sections, rendered in the Light and Dark blocks (and in Night when
 * `night` is true). Each entry is a component from `./gallery/` that reads
 * `useTheme()`. Add a line here when a card adds a component.
 */
const COMPONENT_SECTIONS: { title: string; Component: () => ReactNode; night?: boolean }[] = [
  { title: "Blob", Component: BlobGallery, night: true },
  { title: "Buttons", Component: BtnGallery, night: true },
  { title: "Small components", Component: SmallComponentsGallery },
  { title: "Rich text", Component: RichTextGallery },
];

export function DevGallery({ onBack, section }: { onBack: () => void; section?: string }) {
  const only = section?.toLowerCase();
  const components = only
    ? COMPONENT_SECTIONS.filter((entry) => entry.title.toLowerCase() === only)
    : COMPONENT_SECTIONS;
  const foundations = !only;
  return (
    <ScrollView style={[styles.root, { backgroundColor: lightTokens.bg }]} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} accessibilityRole="button" style={styles.back}>
        <Text style={[styles.backLabel, { color: lightTokens.ink }]}>Back</Text>
      </Pressable>

      <ModeBlock title="Light" tokens={lightTokens} bot={{}}>
        {foundations ? (
          <>
            <Section title="Tokens">
              <TokenChips />
            </Section>
            <Section title="Bot colours">
              <BotChips />
            </Section>
            <Section title="Type scale">
              <TypeScale />
            </Section>
            <Section title="Radii">
              <Radii />
            </Section>
          </>
        ) : null}
        {components.map(({ title, Component }) => (
          <Section key={title} title={title}>
            <Component />
          </Section>
        ))}
      </ModeBlock>

      <ModeBlock title="Dark" tokens={darkTokens} bot={{ dark: true }}>
        {foundations ? (
          <>
            <Section title="Tokens">
              <TokenChips />
            </Section>
            <Section title="Bot colours">
              <BotChips />
            </Section>
            <Section title="Type scale">
              <TypeScale />
            </Section>
            <Section title="Radii">
              <Radii />
            </Section>
          </>
        ) : null}
        {components.map(({ title, Component }) => (
          <Section key={title} title={title}>
            <Component />
          </Section>
        ))}

        <ModeBlock title="Night" tokens={darkTokens} bot={{ night: true }}>
          {foundations ? (
            <Section title="Bot colours">
              <BotChips />
            </Section>
          ) : null}
          {components.filter((entry) => entry.night).map(({ title, Component }) => (
            <Section key={title} title={title}>
              <Component />
            </Section>
          ))}
        </ModeBlock>
      </ModeBlock>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingTop: 56,
    gap: 16,
  },
  back: {
    alignSelf: "flex-start",
    paddingVertical: 8,
  },
  backLabel: {
    ...typeScale.optionDescription,
  },
  block: {
    borderWidth: 1,
    borderRadius: radii.card,
    padding: 16,
    gap: 20,
  },
  blockTitle: {
    ...typeScale.optionLabel,
  },
  section: {
    gap: 10,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  chip: {
    width: 72,
    gap: 4,
  },
  swatch: {
    width: 72,
    height: 48,
    borderRadius: radii.row,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sample: {
    ...typeScale.optionLabel,
  },
  chipLabel: {
    fontSize: typeScale.captionMinSize,
    fontFamily: fontFamily.bold,
  },
  chipValue: {
    fontSize: typeScale.captionMinSize,
    fontFamily: fontFamily.medium,
  },
  botList: {
    gap: 16,
  },
  botRow: {
    gap: 8,
  },
  botName: {
    fontSize: typeScale.body.fontSize,
    fontFamily: fontFamily.bold,
  },
  typeList: {
    gap: 14,
  },
  typeRow: {
    gap: 4,
  },
  radiusItem: {
    width: 72,
    gap: 4,
  },
  radiusBox: {
    width: 72,
    height: 72,
    borderWidth: 1,
  },
});
