/**
 * Dev-only gallery for RichText. Shows each markup, nesting and a code chip next
 * to bold, at body size (alert message) and option-description size. Samples
 * are taken from the prototype where it has them (`fyi`, `ship`, `tidy`); the
 * markup-only samples are invented here because the prototype has none.
 */
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { RichText } from "../../ui/RichText";
import { useTheme } from "../../ui/theme";
import { typeScale } from "../../ui/tokens";

const SAMPLES: { label: string; text: string }[] = [
  { label: "Prototype: fyi", text: "Deployed at 21:52. The error rate is back to **0.4%**." },
  { label: "Prototype: ship", text: "All checks passed. Two small UI fixes since 0.2." },
  { label: "Prototype: tidy", text: "I'll archive old files and sort the rest into folders. Nothing gets deleted." },
  { label: "Bold", text: "Build is **green** on the main branch." },
  { label: "Italic", text: "This one is *probably* fine." },
  { label: "Underline", text: "Only __this part__ changed." },
  { label: "Code", text: "Run `puck status end --ok` when it finishes." },
  { label: "Nested", text: "**bold *and italic***" },
  { label: "Code next to bold", text: "**go** `now`" },
  { label: "Stray markers", text: "5 * 3 is 15, and a lone ** stays as typed." },
];

export function RichTextGallery() {
  const { tokens } = useTheme();

  return (
    <ScrollView style={{ backgroundColor: tokens.bg }} contentContainerStyle={styles.content}>
      {SAMPLES.map((sample) => (
        <View key={sample.label} style={[styles.block, { borderColor: tokens.line }]}>
          <Text style={[styles.label, { color: tokens.ink3 }]}>{sample.label}</Text>
          <Text style={[styles.label, { color: tokens.ink3 }]}>Body</Text>
          <RichText text={sample.text} style={typeScale.body} />
          <Text style={[styles.label, { color: tokens.ink3 }]}>Option description</Text>
          <RichText text={sample.text} style={typeScale.optionDescription} />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  block: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, gap: 6 },
  label: { fontSize: 12, fontWeight: "700" },
});
