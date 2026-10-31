import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Animated, Easing, StyleSheet } from "react-native";
import { PuckBlob, type PuckBlobHandle } from "./PuckBlob";

export type OnboardingBlobHeroHandle = {
  reactToAdvance: () => void;
};

const BASE_SIZE = 168;

const STEP_LAYOUT: Record<string, { scale: number; offsetY: number }> = {
  welcome: { scale: 1, offsetY: 0 },
  "sign-in": { scale: 0.84, offsetY: 8 },
  "this-phone": { scale: 0.84, offsetY: 12 },
  claim: { scale: 0.79, offsetY: 16 },
  notifications: { scale: 0.81, offsetY: 10 },
  fullscreen: { scale: 0.81, offsetY: 14 },
  ready: { scale: 0.9, offsetY: -2 },
};

export const OnboardingBlobHero = forwardRef<
  OnboardingBlobHeroHandle,
  { stepId: string; mood: "idle" | "happy" }
>(function OnboardingBlobHero({ stepId, mood }, ref) {
  const blobRef = useRef<PuckBlobHandle>(null);
  const layout = STEP_LAYOUT[stepId] ?? STEP_LAYOUT.welcome;
  const offsetY = useRef(new Animated.Value(layout.offsetY)).current;
  const heroScale = useRef(new Animated.Value(layout.scale)).current;

  useImperativeHandle(ref, () => ({
    reactToAdvance: () => blobRef.current?.reactToAdvance(),
  }));

  useEffect(() => {
    const next = STEP_LAYOUT[stepId] ?? STEP_LAYOUT.welcome;
    Animated.parallel([
      Animated.timing(offsetY, {
        toValue: next.offsetY,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(heroScale, {
        toValue: next.scale,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [heroScale, offsetY, stepId]);

  return (
    <Animated.View
      style={[
        styles.hero,
        {
          transform: [{ translateY: offsetY }, { scale: heroScale }],
        },
      ]}
    >
      <PuckBlob ref={blobRef} size={BASE_SIZE} mood={mood} />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  hero: {
    alignItems: "center",
    marginBottom: 8,
    minHeight: 196,
  },
});
