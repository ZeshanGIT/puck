import type { AlertExtras, AlertOption } from "@puck/shared";
import { anyApi } from "convex/server";
import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Text } from "./ui/Text";
import { readClientId } from "./clientStore";
import { emptyChoice, replyPayload, tapOption, toggleAll, type ChoiceState } from "./choice";
import { leaveIfLocked } from "puck-full-screen";
import { readableError } from "./session";
import { clearDisplayedAlert } from "./urgentDisplay";

/** One row of the backend's `alerts.pending` view. The new alert fields (`AlertExtras`) are optional. */
export interface PendingAlert extends AlertExtras {
  questionId: string;
  question: string;
  botId: string;
  botName: string;
  priority: "normal" | "urgent";
  selectionMode: "single" | "multi";
  presentation: "choice" | "swipe";
  options: AlertOption[];
  createdAt: number;
  /** Set on a snoozed alert opened from Needs you (`alerts.waiting`): its wake time, or null for "until I'm back". */
  status?: "pending" | "snoozed";
  snoozedUntil?: number | null;
}

export function ChoiceScreen({ alert, waiting }: { alert: PendingAlert; waiting: number }) {
  const record = useMutation(anyApi.answers.record);
  const clientIdRef = useRef<string | null>(null);
  const [choice, setChoice] = useState<ChoiceState>(emptyChoice);
  const [customReply, setCustomReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    readClientId()
      .then((id) => {
        clientIdRef.current = id;
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setChoice(emptyChoice);
    setCustomReply("");
    setError(null);
  }, [alert.questionId]);

  async function send(confirmId: string | null, state: ChoiceState) {
    setBusy(true);
    setError(null);
    try {
      const payload = replyPayload({
        mode: alert.selectionMode,
        state,
        confirmId,
        customReply,
      });
      const clientId = clientIdRef.current ?? (await readClientId());
      await record({
        questionId: alert.questionId,
        ...(clientId ? { clientId } : {}),
        optionIds: payload.optionIds,
        ...(payload.customReply ? { customReply: payload.customReply } : {}),
      });
      await clearDisplayedAlert(alert.questionId);
      if (waiting <= 1) leaveIfLocked();
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  function onOption(optionId: string) {
    const next = tapOption(choice, alert.selectionMode, optionId);
    setChoice(next.state);
    setError(null);
    if (next.confirmId) void send(next.confirmId, next.state);
  }

  const allSelected = alert.options.every((option) => choice.selectedIds.includes(option.id));

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.kicker}>
        {alert.botName}
        {alert.priority === "urgent" ? " · Urgent" : ""}
        {waiting > 1 ? ` · 1 of ${waiting}` : ""}
      </Text>
      <Text accessibilityRole="header" style={styles.title}>{alert.question}</Text>
      <Text style={styles.body}>
        {alert.selectionMode === "single" ? "Tap an option twice to send it." : "Choose any options, then send."}
      </Text>
      {alert.selectionMode === "multi" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          onPress={() => {
            setChoice(toggleAll(choice, alert.options.map((option) => option.id)));
            setError(null);
          }}
          disabled={busy}
        >
          <Text style={styles.link}>{allSelected ? "Clear all" : "Select all"}</Text>
        </Pressable>
      ) : null}
      {alert.options.map((option) => {
        const armed = choice.armedId === option.id || choice.selectedIds.includes(option.id);
        return (
          <Pressable
            key={option.id}
            accessibilityRole={alert.selectionMode === "multi" ? "checkbox" : "button"}
            accessibilityState={
              alert.selectionMode === "multi"
                ? { checked: armed, disabled: busy }
                : { selected: armed, disabled: busy }
            }
            accessibilityHint={alert.selectionMode === "single" ? (armed ? "Tap again to send" : "Tap twice to send") : undefined}
            onPress={() => onOption(option.id)}
            disabled={busy}
            style={({ pressed }) => [styles.option, armed ? styles.optionArmed : null, pressed || busy ? styles.pressed : null]}
          >
            <Text style={[styles.optionText, armed ? styles.optionTextArmed : null]}>
              {option.icon ? `${option.icon} ` : ""}
              {option.label}
              {alert.selectionMode === "single" && choice.armedId === option.id ? " · tap again" : ""}
            </Text>
          </Pressable>
        );
      })}
      <TextInput
        maxFontSizeMultiplier={1.3}
        value={customReply}
        onChangeText={(value) => {
          setCustomReply(value);
          setError(null);
        }}
        accessibilityLabel="Type a reply"
        placeholder="Or type a reply"
        placeholderTextColor="#a08b80"
        autoCorrect
        style={styles.input}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        onPress={() => void send(null, choice)}
        disabled={busy}
        style={({ pressed }) => [styles.button, pressed || busy ? styles.pressed : null]}
      >
        <Text style={styles.buttonText}>{busy ? "Sending…" : "Send"}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
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
    marginBottom: 16,
  },
  link: {
    color: "#8a4524",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 12,
  },
  option: {
    backgroundColor: "#fffefb",
    borderRadius: 14,
    marginBottom: 10,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  optionArmed: {
    backgroundColor: "#2a1814",
  },
  optionText: {
    color: "#3c241c",
    fontSize: 18,
    fontWeight: "600",
  },
  optionTextArmed: {
    color: "#fff9f5",
  },
  input: {
    backgroundColor: "#fffefb",
    borderRadius: 14,
    color: "#3c241c",
    fontSize: 18,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  error: {
    color: "#8a2f24",
    fontSize: 16,
    lineHeight: 22,
    marginTop: 12,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#2a1814",
    borderRadius: 14,
    marginTop: 20,
    paddingVertical: 16,
  },
  pressed: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#fff9f5",
    fontSize: 17,
    fontWeight: "700",
  },
});
