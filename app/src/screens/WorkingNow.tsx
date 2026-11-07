/**
 * H5 Working now: the "Working now" section of Home, a `LiveCard` per running task, hidden when
 * there are none. It sits below Needs you (a running task needs nothing from him). Prototype:
 * `S.live ? <div class="sect">Working now</div>...` in `SCREENS.home`.
 */
import { StyleSheet, View } from "react-native";
import { Text } from "../ui/Text";
import type { LiveActivity } from "../liveCardModel";
import { LiveCard } from "../ui/LiveCard";
import { useTheme } from "../ui/theme";
import { fontFamily } from "../ui/tokens";

export function WorkingNow({
  activities,
  now,
  onOpen,
}: {
  activities: readonly LiveActivity[] | undefined;
  now: number;
  /** A tap on a card: the task's link if it gave one, else nothing happens. */
  onOpen?: (activity: LiveActivity) => void;
}) {
  const t = useTheme().tokens;
  if (!activities || activities.length === 0) return null;
  return (
    <View testID="working-now">
      <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={[styles.section, { color: t.ink3 }]}>
        Working now
      </Text>
      <View style={styles.cards}>
        {activities.map((activity) => (
          <LiveCard
            key={activity.activityId}
            activity={activity}
            now={now}
            onPress={onOpen && activity.link ? () => onOpen(activity) : undefined}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /** `.sect{padding:22px 22px 6px}` */
  section: {
    fontFamily: fontFamily.black,
    fontSize: 12.5,
    fontWeight: "900",
    letterSpacing: 12.5 * 0.08,
    textTransform: "uppercase",
    paddingTop: 22,
    paddingHorizontal: 22,
    paddingBottom: 6,
  },
  /** `padding:0 16px` */
  cards: { paddingHorizontal: 16, gap: 10 },
});
