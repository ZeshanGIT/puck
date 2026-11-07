import { anyApi } from "convex/server";
import { useMutation } from "convex/react";
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Text } from "./ui/Text";
import { readClientId } from "./clientStore";
import { readableError } from "./session";

export function PairingScreen({ onClose }: { onClose?: () => void }) {
  const approve = useMutation(anyApi.bots.approvePairing);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [botId, setBotId] = useState<string | null>(null);

  async function submit() {
    const pairingCode = code.trim();
    if (!/^\d{6}$/u.test(pairingCode)) {
      setError("Enter the six-digit code.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const clientId = await readClientId();
      const result = (await approve(clientId ? { pairingCode, clientId } : { pairingCode })) as { botId?: unknown };
      if (typeof result.botId !== "string" || result.botId.length === 0) {
        throw new Error("pairing did not return a bot id");
      }
      setBotId(result.botId);
      setCode("");
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      {onClose ? (
        <Pressable onPress={onClose}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
      ) : null}
      <Text style={styles.kicker}>Puck</Text>
      <Text style={styles.title}>Pair a bot</Text>
      <Text style={styles.body}>Enter the six-digit code from puck add.</Text>
      <TextInput
        maxFontSizeMultiplier={1.3}
        value={code}
        onChangeText={(value) => {
          setCode(value.replace(/\D/g, "").slice(0, 6));
          setError(null);
          setBotId(null);
        }}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={6}
        autoCorrect={false}
        placeholder="000000"
        placeholderTextColor="#a08b80"
        style={styles.input}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {botId ? <Text style={styles.success}>Paired {botId}</Text> : null}
      <Pressable
        onPress={() => void submit()}
        disabled={busy}
        style={({ pressed }) => [styles.button, pressed || busy ? styles.buttonPressed : null]}
      >
        <Text style={styles.buttonText}>{busy ? "Pairing…" : "Pair"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f3e6dc",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  link: {
    color: "#8a4524",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 16,
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
    fontSize: 36,
    fontWeight: "700",
    marginBottom: 8,
  },
  body: {
    color: "#3c241c",
    fontSize: 17,
    lineHeight: 24,
    marginBottom: 20,
  },
  input: {
    backgroundColor: "#fffefb",
    borderRadius: 14,
    color: "#3c241c",
    fontSize: 28,
    letterSpacing: 6,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  error: {
    color: "#8a2f24",
    fontSize: 16,
    lineHeight: 22,
    marginTop: 12,
  },
  success: {
    color: "#3c241c",
    fontSize: 17,
    fontWeight: "600",
    marginTop: 12,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#2a1814",
    borderRadius: 14,
    marginTop: 20,
    paddingVertical: 16,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#fff9f5",
    fontSize: 17,
    fontWeight: "700",
  },
});
