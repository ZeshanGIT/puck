import { anyApi } from "convex/server";
import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Animated, PanResponder, StyleSheet, Text, View } from "react-native";
import { leaveIfLocked } from "puck-full-screen";
import type { PendingAlert } from "./ChoiceScreen";
import { readableError } from "./session";
import { swipeCanBegin, swipeChoice } from "./swipe";
import { clearDisplayedAlert } from "./urgentDisplay";

export function SwipeScreen({ alert, waiting }: { alert: PendingAlert; waiting: number }) {
  const record = useMutation(anyApi.answers.record);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latched, setLatched] = useState<string | null>(null);
  const drag = useRef(new Animated.Value(0)).current;
  const dragX = useRef(0);
  const busyRef = useRef(false);
  const optionsRef = useRef(alert.options);
  const questionIdRef = useRef(alert.questionId);
  const waitingRef = useRef(waiting);
  const recordRef = useRef(record);
  const readyRef = useRef(false);
  const trackingRef = useRef(false);
  optionsRef.current = alert.options;
  questionIdRef.current = alert.questionId;
  waitingRef.current = waiting;
  recordRef.current = record;

  useEffect(() => {
    drag.setValue(0);
    dragX.current = 0;
    readyRef.current = false;
    trackingRef.current = false;
    setLatched(null);
    setError(null);
    setBusy(false);
    busyRef.current = false;
    const timer = setTimeout(() => {
      readyRef.current = true;
    }, 400);
    return () => clearTimeout(timer);
  }, [alert.questionId, drag]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        readyRef.current && !busyRef.current && swipeCanBegin(gesture.dx, gesture.dy),
      onPanResponderGrant: () => {
        trackingRef.current = true;
      },
      onPanResponderMove: (_, gesture) => {
        dragX.current = gesture.dx;
        drag.setValue(gesture.dx);
        setLatched(swipeChoice(gesture.dx, optionsRef.current));
      },
      onPanResponderRelease: () => {
        const tracked = trackingRef.current;
        trackingRef.current = false;
        const optionId = tracked ? swipeChoice(dragX.current, optionsRef.current) : null;
        if (!optionId || busyRef.current) {
          dragX.current = 0;
          setLatched(null);
          Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
          return;
        }
        void commit(optionId);
      },
      onPanResponderTerminate: () => {
        trackingRef.current = false;
        dragX.current = 0;
        setLatched(null);
        Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
      },
    }),
  ).current;

  async function commit(optionId: string) {
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await recordRef.current({ questionId: questionIdRef.current, optionIds: [optionId] });
      await clearDisplayedAlert(questionIdRef.current);
      if (waitingRef.current <= 1) leaveIfLocked();
    } catch (caught) {
      setError(readableError(caught));
      dragX.current = 0;
      setLatched(null);
      Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const left = alert.options[0];
  const right = alert.options[1];
  if (!left || !right || alert.options.length !== 2) {
    return (
      <View style={styles.screen}>
        <Text style={styles.error}>This swipe needs two options.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.kicker}>
        {alert.botName}
        {alert.priority === "urgent" ? " · Urgent" : ""}
        {waiting > 1 ? ` · 1 of ${waiting}` : ""}
      </Text>
      <Text style={styles.title}>{alert.question}</Text>
      <Text style={styles.body}>Drag toward an answer. A short pull springs back.</Text>
      <View style={styles.lane} {...pan.panHandlers}>
        <Text style={[styles.side, latched === left.id ? styles.sideLatched : null]}>
          {left.icon ? `${left.icon} ` : ""}
          {left.label}
        </Text>
        <Animated.View style={[styles.handle, { transform: [{ translateX: drag }] }]}>
          <Text style={styles.handleText}>{busy ? "…" : "Drag"}</Text>
        </Animated.View>
        <Text style={[styles.side, styles.sideRight, latched === right.id ? styles.sideLatched : null]}>
          {right.icon ? `${right.icon} ` : ""}
          {right.label}
        </Text>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f3e6dc",
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingVertical: 48,
  },
  kicker: {
    color: "#8a4524",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  title: {
    color: "#3c241c",
    fontSize: 32,
    fontWeight: "700",
    marginBottom: 8,
  },
  body: {
    color: "#3c241c",
    fontSize: 17,
    lineHeight: 24,
    marginBottom: 28,
  },
  lane: {
    minHeight: 180,
    justifyContent: "center",
  },
  side: {
    color: "#3c241c",
    fontSize: 18,
    fontWeight: "700",
    position: "absolute",
    left: 0,
    right: "55%",
  },
  sideRight: {
    left: "55%",
    right: 0,
    textAlign: "right",
  },
  sideLatched: {
    color: "#8a4524",
  },
  handle: {
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#2a1814",
  },
  handleText: {
    color: "#fff9f5",
    fontSize: 16,
    fontWeight: "700",
  },
  error: {
    color: "#8a2f24",
    fontSize: 16,
    lineHeight: 22,
    marginTop: 20,
  },
});
