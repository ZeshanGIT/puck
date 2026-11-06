/**
 * Inline banner, from the prototype's `.banner`, `.banner.quiet` and the
 * `.bt` / `.bb` text and action. The prototype has two tones only: `warn`
 * (the default) and `quiet`. There are no danger, ok or info variants.
 */
import { type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { useTheme } from "./theme";
import { fontFamily } from "./tokens";

export type BannerTone = "warn" | "quiet";

export interface BannerAction {
  label: string;
  onPress: () => void;
  testID?: string;
}

export interface BannerProps {
  message: string;
  tone?: BannerTone;
  /** Defaults to the prototype's `ICON.warn` for `warn` and `ICON.snooze` for `quiet`. */
  icon?: ReactNode;
  action?: BannerAction;
}

/** `.banner`: 16 radius, 14 / 16 padding, 6 dp above and 4 dp below. */
export function Banner({ message, tone = "warn", icon, action }: BannerProps) {
  const t = useTheme().tokens;
  const quiet = tone === "quiet";
  const iconColour = quiet ? t.ink2 : t.warn;
  const actionColour = quiet ? t.ink : t.warn;

  return (
    <View
      style={{
        marginTop: 6,
        marginHorizontal: 16,
        marginBottom: 4,
        padding: 14,
        borderRadius: 16,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        backgroundColor: quiet ? t.fill : t.warnbg,
      }}
    >
      {icon ?? (quiet ? <SnoozeIcon colour={iconColour} /> : <WarnIcon colour={iconColour} />)}
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: t.ink,
            fontFamily: fontFamily.bold,
            fontSize: 14.5,
            lineHeight: 19.6,
          }}
        >
          {message}
        </Text>
        {action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={action.onPress}
            testID={action.testID}
            hitSlop={8}
            style={{ alignSelf: "flex-start", marginTop: 8 }}
          >
            <Text style={{ color: actionColour, fontFamily: fontFamily.black, fontSize: 14 }}>
              {action.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function WarnIcon({ colour }: { colour: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" style={{ marginTop: 1 }}>
      <Path
        d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"
        fill="none"
        stroke={colour}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function SnoozeIcon({ colour }: { colour: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" style={{ marginTop: 1 }}>
      <Circle cx={12} cy={13} r={8} fill="none" stroke={colour} strokeWidth={2.2} />
      <Path
        d="M12 9v4l2.5 2.5M5 3L2 6M19 3l3 3"
        fill="none"
        stroke={colour}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
