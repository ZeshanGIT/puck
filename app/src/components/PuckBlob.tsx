import { LinearGradient } from "expo-linear-gradient";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { puckColors } from "../theme/puckTheme";

const LOOKS: { x: number; y: number; t: number; blink?: boolean; twice?: boolean }[] = [
  { x: 0, y: 6, t: 1300 },
  { x: -9, y: 7, t: 540 },
  { x: 0, y: 6, t: 380, blink: true },
  { x: 9, y: 6, t: 500 },
  { x: 1, y: -2, t: 620 },
  { x: 0, y: 6, t: 1500 },
  { x: -7, y: 4, t: 360 },
  { x: 8, y: 8, t: 400 },
  { x: 0, y: 6, t: 700, blink: true, twice: true },
  { x: 4, y: -3, t: 480 },
  { x: -9, y: 6, t: 460 },
  { x: 0, y: 6, t: 1600 },
];

export type PuckBlobHandle = {
  reactToAdvance: () => void;
};

export const PuckBlob = forwardRef<
  PuckBlobHandle,
  {
    size?: number;
    mood?: "idle" | "happy";
  }
>(function PuckBlob({ size = 156, mood = "idle" }, ref) {
  const bob = useRef(new Animated.Value(0)).current;
  const tilt = useRef(new Animated.Value(-2.4)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const gazeX = useRef(new Animated.Value(0)).current;
  const gazeY = useRef(new Animated.Value(6)).current;
  const leftEye = useRef(new Animated.Value(1)).current;
  const rightEye = useRef(new Animated.Value(1)).current;
  const mouthOpacity = useRef(new Animated.Value(mood === "happy" ? 1 : 0.72)).current;
  const reactPulse = useRef(new Animated.Value(0)).current;

  useImperativeHandle(ref, () => ({
    reactToAdvance() {
      reactPulse.setValue(0);
      Animated.sequence([
        Animated.parallel([
          Animated.timing(reactPulse, { toValue: 1, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(gazeY, { toValue: 2, duration: 120, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.spring(reactPulse, { toValue: 0, speed: 16, bounciness: 12, useNativeDriver: true }),
          Animated.timing(gazeY, { toValue: 6, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]),
      ]).start();
    },
  }));

  const wrapW = Math.round(size * 1.12);
  const wrapH = Math.round(size * 1.08);
  const radius = Math.round(size * 0.346);
  const eyeW = Math.round(size * 0.096);
  const eyeH = Math.round(size * 0.192);
  const glowSize = Math.round(size * 1.37);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(bob, { toValue: -7, duration: 1750, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(tilt, { toValue: 2.4, duration: 1750, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1.045, duration: 1750, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(bob, { toValue: 0, duration: 1750, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(tilt, { toValue: -2.4, duration: 1750, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 1750, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob, scale, tilt]);

  useEffect(() => {
    if (mood === "happy") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let index = 0;

    function blinkEyes(twice?: boolean) {
      Animated.sequence([
        Animated.parallel([
          Animated.timing(leftEye, { toValue: 0.1, duration: 70, useNativeDriver: true }),
          Animated.timing(rightEye, { toValue: 0.1, duration: 70, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(leftEye, { toValue: 1, duration: 110, useNativeDriver: true }),
          Animated.timing(rightEye, { toValue: 1, duration: 110, useNativeDriver: true }),
        ]),
      ]).start();
      if (twice) setTimeout(() => blinkEyes(), 230);
    }

    function step() {
      if (cancelled) return;
      const look = LOOKS[index % LOOKS.length];
      index += 1;
      Animated.parallel([
        Animated.timing(gazeX, { toValue: look.x, duration: Math.min(look.t, 420), useNativeDriver: true }),
        Animated.timing(gazeY, { toValue: look.y, duration: Math.min(look.t, 420), useNativeDriver: true }),
      ]).start();
      if (look.blink) blinkEyes(look.twice);
      timer = setTimeout(step, look.t);
    }

    step();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [gazeX, gazeY, leftEye, mood, rightEye]);

  useEffect(() => {
    Animated.timing(mouthOpacity, {
      toValue: mood === "happy" ? 1 : 0.78,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [mood, mouthOpacity]);

  const reactScale = reactPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.9] });
  const reactLift = reactPulse.interpolate({ inputRange: [0, 1], outputRange: [0, 6] });

  return (
    <View style={[styles.wrap, { width: wrapW, height: wrapH }]}>
      <View
        pointerEvents="none"
        style={[
          styles.glow,
          {
            width: glowSize,
            height: glowSize,
            borderRadius: glowSize / 2,
            top: size * 0.12,
            left: (wrapW - glowSize) / 2,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.groundShadow,
          {
            width: size * 0.72,
            bottom: 6,
          },
        ]}
      />
      <Animated.View
        style={[
          styles.blobOuter,
          {
            width: size,
            height: size,
            borderRadius: radius,
            transform: [
              { translateY: Animated.add(bob, reactLift) },
              { rotate: tilt.interpolate({ inputRange: [-10, 10], outputRange: ["-10deg", "10deg"] }) },
              { scale: Animated.multiply(scale, reactScale) },
            ],
          },
        ]}
      >
        <LinearGradient
          colors={["#ff7a68", "#ef4d3c", puckColors.coralDeep]}
          locations={[0, 0.4, 1]}
          style={[styles.blobFill, { borderRadius: radius - 5 }]}
        >
          <View style={[styles.shine, { borderRadius: radius - 5 }]} pointerEvents="none" />
          <Animated.View
            style={[
              styles.gaze,
              mood === "happy" ? styles.gazeHappy : null,
              {
                transform: [{ translateX: gazeX }, { translateY: gazeY }, { rotate: "-12deg" }],
              },
            ]}
          >
            {mood === "happy" ? (
              <>
                <View style={[styles.happyEye, { width: eyeW + 1 }]} />
                <View style={[styles.happyEye, { width: eyeW + 1 }]} />
              </>
            ) : (
              <>
                <Animated.View style={[styles.eye, { width: eyeW, height: eyeH, transform: [{ scaleY: leftEye }] }]} />
                <Animated.View style={[styles.eye, { width: eyeW, height: eyeH, transform: [{ scaleY: rightEye }] }]} />
              </>
            )}
          </Animated.View>
          <Animated.View
            style={[
              styles.mouth,
              mood === "happy" ? styles.mouthHappy : styles.mouthIdle,
              {
                bottom: size * 0.21,
                opacity: mouthOpacity,
              },
            ]}
          />
        </LinearGradient>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "flex-end",
    overflow: "visible",
  },
  glow: {
    backgroundColor: "rgba(255, 212, 200, 0.45)",
    position: "absolute",
  },
  groundShadow: {
    backgroundColor: "rgba(90, 32, 20, 0.22)",
    borderRadius: 999,
    height: 14,
    position: "absolute",
  },
  blobOuter: {
    borderColor: "#fff",
    borderRadius: 54,
    borderWidth: 5,
    overflow: "hidden",
  },
  blobFill: {
    flex: 1,
    justifyContent: "center",
  },
  shine: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "transparent",
    borderTopColor: "rgba(255,255,255,0.28)",
    borderTopWidth: 12,
  },
  gaze: {
    alignSelf: "center",
    flexDirection: "row",
    gap: 7,
  },
  gazeHappy: {
    marginTop: 4,
  },
  eye: {
    backgroundColor: "#fff",
    borderRadius: 999,
  },
  happyEye: {
    borderColor: "#fff",
    borderRadius: 12,
    borderTopWidth: 3.5,
    height: 11,
  },
  mouth: {
    alignSelf: "center",
    borderBottomColor: "#fff",
    borderBottomWidth: 3.5,
    height: 10,
    position: "absolute",
    width: 22,
  },
  mouthIdle: {
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    transform: [{ scaleX: 0.88 }],
  },
  mouthHappy: {
    borderRadius: 16,
    transform: [{ scaleX: 1 }],
  },
});
