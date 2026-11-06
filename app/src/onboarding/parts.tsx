/**
 * Small pieces shared by the onboarding screens O0 to O4, copied from the prototype's CSS in
 * `vault/Projects/Puck/mockups/Puck prototype.html` (`.scr`, `.hero`, `.spin`, `.code`, `.cap`)
 * and its `ICON` paths. Colours come from `useTheme()` only.
 */
import { type ReactNode, useEffect, useRef } from "react";
import { Animated, Easing, StatusBar, StyleSheet, Text, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { useTheme } from "../ui/theme";
import { fontFamily } from "../ui/tokens";

/** `.scr`: the screen background, under a status bar and above the gesture bar. */
export function OnboardingFrame({ children }: { children: ReactNode }) {
  const t = useTheme().tokens;
  return (
    <View style={[styles.frame, { backgroundColor: t.bg, paddingTop: (StatusBar.currentHeight ?? 24) + 8 }]}>
      {children}
    </View>
  );
}

/** `.hero h1` and `.hero p`. Centered by default; `left` is the O2 and O4 variant. */
export function HeroText({
  title,
  body,
  left = false,
  titleSize = 28,
  bodySize = 16,
  paddingBottom = 10,
}: {
  title: string;
  body?: string;
  left?: boolean;
  titleSize?: number;
  bodySize?: number;
  /** Left variant only: 18 for O2, 10 for O4. */
  paddingBottom?: number;
}) {
  const t = useTheme().tokens;
  return (
    <View style={left ? [styles.heroLeft, { paddingBottom }] : styles.heroCenter}>
      <Text
        accessibilityRole="header"
        style={{
          color: t.ink,
          fontFamily: fontFamily.black,
          fontSize: titleSize,
          lineHeight: titleSize * 1.15,
          letterSpacing: titleSize * -0.015,
          textAlign: left ? "left" : "center",
          marginTop: left ? 0 : 18,
        }}
      >
        {title}
      </Text>
      {body ? (
        <Text
          style={{
            color: t.ink2,
            fontFamily: fontFamily.semiBold,
            fontSize: bodySize,
            lineHeight: bodySize * 1.45,
            textAlign: left ? "left" : "center",
            marginTop: 10,
          }}
        >
          {body}
        </Text>
      ) : null}
    </View>
  );
}

/** `.spin`: 14 dp ring, 2.5 dp edge, the top segment in ink2, one turn per 0.7 s. */
export function Spinner({ size = 14 }: { size?: number }) {
  const t = useTheme().tokens;
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(turn, { toValue: 1, duration: 700, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [turn]);
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2.5,
        borderColor: t.edge,
        borderTopColor: t.ink2,
        transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }],
      }}
    />
  );
}

/** `.cap`: 13.5 / 600 caption under a block. */
export function Caption({ children }: { children: string }) {
  const t = useTheme().tokens;
  return (
    <Text
      style={{
        color: t.ink3,
        fontFamily: fontFamily.semiBold,
        fontSize: 13.5,
        lineHeight: 13.5 * 1.4,
        paddingHorizontal: 22,
        paddingTop: 8,
      }}
    >
      {children}
    </Text>
  );
}

/** "Waiting for a bot…" style status line: a spinner and 15 / 800 ink3 text. */
export function WaitingLine({ children }: { children: string }) {
  const t = useTheme().tokens;
  return (
    <View style={styles.waiting}>
      <Spinner />
      <Text style={{ color: t.ink3, fontFamily: fontFamily.extraBold, fontSize: 15 }}>{children}</Text>
    </View>
  );
}

/* ---------- icons (prototype `ICON`) ---------- */

function IconBox({ size, children }: { size: number; children: ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {children}
    </Svg>
  );
}

const stroke = (colour: string, width: number) => ({
  fill: "none",
  stroke: colour,
  strokeWidth: width,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export function BellIcon({ colour, size = 20 }: { colour: string; size?: number }) {
  return (
    <IconBox size={size}>
      <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10.3 20a1.9 1.9 0 0 0 3.4 0" {...stroke(colour, 2.1)} />
    </IconBox>
  );
}

export function ScreenIcon({ colour, size = 20 }: { colour: string; size?: number }) {
  return (
    <IconBox size={size}>
      <Rect x={6} y={2.5} width={12} height={19} rx={2.5} {...stroke(colour, 2.1)} />
      <Path d="M10 18.5h4" {...stroke(colour, 2.1)} />
    </IconBox>
  );
}

export function MoonIcon({ colour, size = 20 }: { colour: string; size?: number }) {
  return (
    <IconBox size={size}>
      <Path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" {...stroke(colour, 2.1)} />
    </IconBox>
  );
}

export function CopyIcon({ colour, size = 18 }: { colour: string; size?: number }) {
  return (
    <IconBox size={size}>
      <Rect x={9} y={9} width={11} height={11} rx={2} {...stroke(colour, 2)} />
      <Path d="M5 15V5a1 1 0 0 1 1-1h9" {...stroke(colour, 2)} />
    </IconBox>
  );
}

export function CheckIcon({ colour, size = 15, width = 3 }: { colour: string; size?: number; width?: number }) {
  return (
    <IconBox size={size}>
      <Path d="M5 12.5l4.5 4.5L19 7.5" {...stroke(colour, width)} />
    </IconBox>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  heroCenter: { alignItems: "center", paddingHorizontal: 28, paddingTop: 10 },
  heroLeft: { alignItems: "flex-start", paddingHorizontal: 22, paddingTop: 18 },
  waiting: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 22,
    paddingTop: 26,
  },
});
