/**
 * A5 Custom reply: a sheet over the alert (prototype `openSheet("reply")`, `.rwrap`, `.listen`,
 * `.tray`, `.thumb`, `.fchip`, `.rm`, `.tools`, `.tool`, `.with`).
 *
 * A text field, a mic (on-device speech recognition, with a listening state), camera, photo and
 * file buttons, a tray of what is attached (each with a x), "with: <option>" when an option is
 * armed or checked, and Send in one tap. Replies never need a second tap (Q26).
 *
 * Files upload to Convex storage as soon as they are picked, with progress; Send waits for them.
 * Closing the sheet (tap outside, back) keeps the text and the tray, as A5 says. After `onSend`
 * resolves the sheet closes and clears; if it throws, a Toast shows the error and the sheet stays.
 *
 * Without `getUploadUrl` the sheet asks Convex for one (`files.generateUploadUrl`), which needs the
 * Convex provider. Pass `getUploadUrl` to use the sheet without it (the dev gallery).
 */
import { anyApi } from "convex/server";
import { useMutation } from "convex/react";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { createContext, type ComponentRef, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import {
  UploadCancelled,
  admitFiles,
  canSend,
  choosePhotos,
  chooseFiles,
  formatBytes,
  fullMessage,
  replyText,
  roomLeft,
  takePhoto,
  uploadAttachment,
  withDictation,
  REPLY_MAX,
  type PickResult,
  type PickedFile,
  type UploadedAttachment,
} from "../attachments";
import type { PendingAlert } from "../ChoiceScreen";
import { readClientId } from "../clientStore";
import { readableError } from "../session";
import { botLook } from "../ui/botLook";
import { Btn } from "../ui/Btn";
import { Sheet, SheetText, SheetTitle } from "../ui/Sheet";
import { useBotTheme, useTheme } from "../ui/theme";
import { Toast, useToast } from "../ui/Toast";
import { fontFamily } from "../ui/tokens";
import { haptics } from "../ui/useTapTwice";

export interface ArmedOption {
  id: string;
  label: string;
}

export interface A5ReplyProps {
  visible: boolean;
  onClose: () => void;
  alert: PendingAlert;
  /**
   * The option the reply goes with ("with: Ship it"). A list is for a multi alert with several
   * options checked: their labels are joined with ", " as in the prototype.
   */
  armedOption?: ArmedOption | readonly ArmedOption[] | null;
  /** Sends the reply. Resolves when it is recorded; throws to keep the sheet open with a Toast. */
  onSend: (optionIds: string[], customReply: string, attachments: UploadedAttachment[]) => Promise<void>;
  /** An upload URL from Convex storage. Defaults to `files.generateUploadUrl` for this client. */
  getUploadUrl?: () => Promise<string>;
}

export function A5Reply(props: A5ReplyProps) {
  return props.getUploadUrl ? (
    <A5ReplySheet {...props} getUploadUrl={props.getUploadUrl} />
  ) : (
    <ConnectedA5Reply {...props} />
  );
}

/** Needs the Convex provider, which is why it is split off. */
function ConnectedA5Reply(props: A5ReplyProps) {
  const generate = useMutation(anyApi.files.generateUploadUrl);
  const getUploadUrl = useCallback(async () => {
    const clientId = await readClientId();
    if (!clientId) throw new Error("Sign in to attach files");
    return (await generate({ clientId })) as string;
  }, [generate]);
  return <A5ReplySheet {...props} getUploadUrl={getUploadUrl} />;
}

interface TrayItem {
  id: string;
  file: PickedFile;
  status: "uploading" | "done" | "error";
  progress: number;
  uploaded?: UploadedAttachment;
  error?: string;
}

/** Wave bars: `.listen i`, 5 x 18, scaleY 1 to .35 and back every .9 s, each .1 s later than the last. */
const WAVE_DELAYS_MS = [0, 100, 200, 300, 400] as const;

function armedList(armed: A5ReplyProps["armedOption"]): ArmedOption[] {
  if (!armed) return [];
  return Array.isArray(armed) ? [...armed] : [armed as ArmedOption];
}

function A5ReplySheet({
  visible,
  onClose,
  alert,
  armedOption,
  onSend,
  getUploadUrl,
}: A5ReplyProps & { getUploadUrl: () => Promise<string> }) {
  const { tokens: t } = useTheme();
  const bot = useMemo(() => botLook({ botId: alert.botId, botName: alert.botName }), [alert.botId, alert.botName]);
  const bt = useBotTheme(bot);
  const toast = useToast();

  const [text, setText] = useState("");
  const [items, setItems] = useState<TrayItem[]>([]);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);

  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const before = useRef("");
  const controllers = useRef(new Map<string, AbortController>());
  const nextId = useRef(0);
  const alive = useRef(true);
  const picking = useRef(false);
  // Latest tray for the pickers, which can resolve after a render.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const getUploadUrlRef = useRef(getUploadUrl);
  getUploadUrlRef.current = getUploadUrl;

  const armed = armedList(armedOption);
  const withLabel = armed.length > 0 ? armed.map((o) => o.label).join(", ") : null;

  const uploading = items.some((item) => item.status === "uploading");
  const failed = items.some((item) => item.status === "error");
  const sendEnabled = !busy && canSend({ text, attachments: items.length, hasOption: armed.length > 0, uploading, failed });

  useEffect(() => {
    alive.current = true;
    const live = controllers.current;
    return () => {
      alive.current = false;
      for (const controller of live.values()) controller.abort();
      live.clear();
    };
  }, []);

  // A different alert starts a blank reply.
  useEffect(() => {
    reset();
  }, [alert.questionId]);

  // The prototype focuses the field 300 ms after the sheet opens. Closing puts the keyboard away
  // and ends dictation, keeping the words heard so far.
  useEffect(() => {
    if (!visible) {
      Keyboard.dismiss();
      if (listening) ExpoSpeechRecognitionModule.stop();
      return;
    }
    const id = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(id);
  }, [visible]);

  function reset() {
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();
    if (listening) ExpoSpeechRecognitionModule.abort();
    setText("");
    setItems([]);
    setListening(false);
    setHeard(false);
  }

  // ---- dictation ----

  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript ?? "";
    if (!transcript.trim()) return;
    setHeard(true);
    setText(withDictation(before.current, transcript).slice(0, REPLY_MAX));
  });
  useSpeechRecognitionEvent("end", () => {
    setListening(false);
    setHeard(false);
  });
  useSpeechRecognitionEvent("error", (event) => {
    setListening(false);
    setHeard(false);
    const message = dictationProblem(event.error);
    if (message) toast.show(message);
  });

  async function onMic() {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    if (busy) return;
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        toast.show("Allow the microphone and speech recognition in Settings to dictate");
        return;
      }
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        toast.show("Speech recognition isn't available on this phone");
        return;
      }
      before.current = textRef.current;
      setHeard(false);
      setListening(true);
      ExpoSpeechRecognitionModule.start({
        interimResults: true,
        continuous: false,
        addsPunctuation: true,
        // Keep the audio on the phone when the phone can (Q22). Otherwise Android's default service runs.
        requiresOnDeviceRecognition: ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
      });
    } catch {
      setListening(false);
      toast.show("Couldn't start dictation");
    }
  }

  // ---- attachments ----

  function updateItem(id: string, patch: Partial<TrayItem>) {
    if (!alive.current) return;
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function startUpload(item: TrayItem) {
    const controller = new AbortController();
    controllers.current.set(item.id, controller);
    updateItem(item.id, { status: "uploading", progress: 0, error: undefined });
    try {
      const uploaded = await uploadAttachment(
        item.file,
        () => getUploadUrlRef.current(),
        (fraction) => updateItem(item.id, { progress: fraction }),
        controller.signal,
      );
      updateItem(item.id, { status: "done", progress: 1, uploaded });
    } catch (caught) {
      if (caught instanceof UploadCancelled || controller.signal.aborted) return;
      const message = readableError(caught);
      updateItem(item.id, { status: "error", error: message });
      if (alive.current) toast.show(message);
    } finally {
      if (controllers.current.get(item.id) === controller) controllers.current.delete(item.id);
    }
  }

  function addFiles(files: PickedFile[]) {
    const { kept, message } = admitFiles(files, itemsRef.current.length);
    if (message) toast.show(message);
    if (kept.length === 0) return;
    const added = kept.map<TrayItem>((file) => ({
      id: `a${nextId.current++}`,
      file,
      status: "uploading",
      progress: 0,
    }));
    itemsRef.current = [...itemsRef.current, ...added];
    setItems(itemsRef.current);
    for (const item of added) void startUpload(item);
  }
  async function pick(run: (room: number) => Promise<PickResult>) {
    if (picking.current || busy) return;
    const full = fullMessage(itemsRef.current.length);
    if (full) {
      toast.show(full);
      return;
    }
    picking.current = true;
    try {
      if (listening) ExpoSpeechRecognitionModule.stop();
      const result = await run(roomLeft(itemsRef.current.length));
      if (!alive.current) return;
      if (result.status === "denied") toast.show(result.message);
      else if (result.status === "ok") addFiles(result.files);
    } catch (caught) {
      if (alive.current) toast.show(readableError(caught));
    } finally {
      picking.current = false;
    }
  }

  function removeItem(id: string) {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }

  // ---- send ----

  async function send() {
    if (!sendEnabled) return;
    setBusy(true);
    try {
      const uploaded = items.flatMap((item) => (item.uploaded ? [item.uploaded] : []));
      await onSend(
        armed.map((option) => option.id),
        replyText(text),
        uploaded,
      );
      if (!alive.current) return;
      setText("");
      setItems([]);
      onClose();
    } catch (caught) {
      if (!alive.current) return;
      haptics.error();
      toast.show(readableError(caught));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        if (!busy) onClose();
      }}
      testID="a5-reply"
    >
      <KeyboardAvoidingView behavior="padding">
        <SheetTitle>{`Reply to ${alert.botName}`}</SheetTitle>
        <SheetText>Type, dictate, or add a photo or file.</SheetText>

        {withLabel ? (
          <View style={[styles.with, { backgroundColor: bt.botTint, borderColor: bt.bot }]}>
            <Text style={[styles.withText, { color: t.ink }]}>{`with: ${withLabel}`}</Text>
          </View>
        ) : null}

        {items.length > 0 ? (
          <View style={styles.tray} testID="a5-tray">
            {items.map((item) => (
              <TrayEntry key={item.id} item={item} onRemove={() => removeItem(item.id)} onRetry={() => void startUpload(item)} />
            ))}
          </View>
        ) : null}

        <View>
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            editable={!listening && !busy}
            multiline
            // Enter puts the keyboard away instead of adding a line: the backend takes one line.
            submitBehavior="blurAndSubmit"
            maxLength={REPLY_MAX}
            placeholder="Your reply"
            placeholderTextColor={t.ink3}
            accessibilityLabel="Your reply"
            textAlignVertical="top"
            style={[
              styles.input,
              { backgroundColor: t.bg, color: t.ink, borderColor: focused ? t.ink : t.line },
            ]}
          />
          {listening && !heard ? <Listening danger={t.danger} cardBg={t.card} /> : null}
        </View>

        <View style={styles.tools}>
          <ToolButton label="Dictate" recording={listening} onPress={() => void onMic()}>
            <MicIcon />
          </ToolButton>
          <ToolButton label="Take a photo" onPress={() => void pick(() => takePhoto())}>
            <CameraIcon />
          </ToolButton>
          <ToolButton label="Choose a photo" onPress={() => void pick((room) => choosePhotos(room))}>
            <ImageIcon />
          </ToolButton>
          <ToolButton label="Attach a file" onPress={() => void pick(() => chooseFiles())}>
            <ClipIcon />
          </ToolButton>
          <Btn
            label={busy ? "Sending…" : "Send"}
            variant="bot"
            bot={bot}
            disabled={!sendEnabled}
            onPress={() => void send()}
            style={styles.send}
            testID="a5-send"
          />
        </View>

        {/* Floats just above the sheet so it shows over the scrim (a Toast in the alert would sit under this Modal). */}
        <View pointerEvents="none" style={styles.toastSlot}>
          <Toast message={toast.message} visible={toast.visible} />
        </View>
      </KeyboardAvoidingView>
    </Sheet>
  );
}

/** What to tell Seshan when dictation stops with an error, or null for a quiet stop. */
function dictationProblem(code: string): string | null {
  switch (code) {
    case "aborted":
      return null;
    case "not-allowed":
      return "Allow the microphone and speech recognition in Settings to dictate";
    case "no-speech":
    case "speech-timeout":
      return "Didn't catch that. Try again.";
    case "audio-capture":
      return "Couldn't use the microphone";
    default:
      return "Speech recognition isn't available right now";
  }
}

// ---- pieces ----

/** `.listen`: covers the field with five waving bars and "Listening…". */
function Listening({ danger, cardBg }: { danger: string; cardBg: string }) {
  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityLabel="Listening"
      style={[styles.listen, { backgroundColor: cardBg, borderColor: danger }]}
    >
      {WAVE_DELAYS_MS.map((delay) => (
        <WaveBar key={delay} delay={delay} colour={danger} />
      ))}
      <Text style={[styles.listenText, { color: danger }]}>Listening…</Text>
    </View>
  );
}

function WaveBar({ delay, colour }: { delay: number; colour: string }) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) {
      scale.value = 1;
      return;
    }
    scale.value = withDelay(
      delay,
      withRepeat(withTiming(0.35, { duration: 450, easing: Easing.inOut(Easing.ease) }), -1, true),
    );
  }, [delay, reduceMotion, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: scale.value }] }));
  return <Animated.View style={[styles.bar, { backgroundColor: colour }, style]} />;
}

/** `.tool`: a 48 dp round button; `.tool.rec` while dictating. */
function ToolButton({
  label,
  recording = false,
  onPress,
  children,
}: {
  label: string;
  recording?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const { tokens: t } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: recording }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tool,
        { backgroundColor: recording ? t.dangerbg : pressed ? t.fill2 : t.fill },
      ]}
    >
      {/* Icons read their stroke from here: `.tool svg` ink, `.tool.rec svg` danger. */}
      <ToolStroke.Provider value={recording ? t.danger : t.ink}>{children}</ToolStroke.Provider>
    </Pressable>
  );
}

/** One tray entry: a 64 dp thumbnail for a photo, a chip with the name and size for a file. */
function TrayEntry({ item, onRemove, onRetry }: { item: TrayItem; onRemove: () => void; onRetry: () => void }) {
  const { tokens: t } = useTheme();
  const { file } = item;
  const size = item.uploaded?.size ?? file.size;
  const percent = `${Math.round(item.progress * 100)}%`;
  const detail =
    item.status === "uploading" ? percent : item.status === "error" ? "Failed · tap to retry" : size === null ? "" : formatBytes(size);

  return (
    // The wrapper reaches 7 dp past the item so the x, which sits on the corner, can be tapped.
    <View style={styles.entry}>
      <Pressable
        accessibilityRole={item.status === "error" ? "button" : undefined}
        accessibilityLabel={`${file.name}, ${item.status === "uploading" ? `uploading ${percent}` : item.status === "error" ? "upload failed, tap to retry" : "attached"}`}
        disabled={item.status !== "error"}
        onPress={onRetry}
      >
        {file.type === "photo" ? (
          <View style={[styles.thumb, { backgroundColor: t.fill2 }]}>
            <Image source={{ uri: file.uri }} style={styles.thumbImage} resizeMode="cover" accessibilityIgnoresInvertColors />
            {item.status !== "done" ? (
              <View
                style={[
                  styles.thumbOverlay,
                  { backgroundColor: item.status === "error" ? "rgba(179, 38, 30, 0.6)" : "rgba(0, 0, 0, 0.35)" },
                ]}
              >
                {item.status === "error" ? (
                  <Text style={styles.thumbMark}>!</Text>
                ) : (
                  <View style={styles.thumbTrack}>
                    <View style={[styles.thumbFill, { width: `${item.progress * 100}%` }]} />
                  </View>
                )}
              </View>
            ) : null}
          </View>
        ) : (
          <View style={[styles.fchip, { backgroundColor: t.fill }]}>
            <ToolStroke.Provider value={t.ink2}>
              <DocIcon />
            </ToolStroke.Provider>
            <View style={styles.fchipText}>
              <Text numberOfLines={1} style={[styles.fchipName, { color: t.ink }]}>
                {file.name}
              </Text>
              {detail ? (
                <Text style={[styles.fchipSmall, { color: item.status === "error" ? t.danger : t.ink3 }]}>{detail}</Text>
              ) : null}
            </View>
          </View>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${file.name}`}
        onPress={onRemove}
        hitSlop={8}
        style={[styles.rm, { backgroundColor: t.ink }]}
      >
        <Text style={[styles.rmText, { color: t.bg }]}>×</Text>
      </Pressable>
    </View>
  );
}

// ---- icons: the prototype's `ICON.mic`, `camera`, `image`, `clip`, `doc` ----


const ToolStroke = createContext("#1E1B19");

function Icon({ size, strokeWidth, children }: { size: number; strokeWidth: number; children: ReactNode }) {
  const stroke = useContext(ToolStroke);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </Svg>
  );
}

function MicIcon() {
  return (
    <Icon size={21} strokeWidth={2}>
      <Rect x={9} y={3} width={6} height={11} rx={3} />
      <Path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </Icon>
  );
}

function CameraIcon() {
  return (
    <Icon size={21} strokeWidth={2}>
      <Path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <Circle cx={12} cy={13.5} r={3.5} />
    </Icon>
  );
}

function ImageIcon() {
  return (
    <Icon size={21} strokeWidth={2}>
      <Rect x={3} y={4} width={18} height={16} rx={2} />
      <Circle cx={8.5} cy={9.5} r={1.5} />
      <Path d="M21 16l-5-5-9 9" />
    </Icon>
  );
}

function ClipIcon() {
  return (
    <Icon size={21} strokeWidth={2}>
      <Path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7-7l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" />
    </Icon>
  );
}

function DocIcon() {
  return (
    <Icon size={22} strokeWidth={2}>
      <Path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z" />
      <Path d="M14 3v4h4" />
    </Icon>
  );
}

const styles = StyleSheet.create({
  // `.with`
  with: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1.5,
    marginBottom: 12,
  } satisfies ViewStyle,
  withText: { fontFamily: fontFamily.extraBold, fontSize: 14 },
  // `.tray`
  tray: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 10 } satisfies ViewStyle,
  entry: { paddingTop: 7, paddingRight: 7, marginTop: -7, marginRight: -7 } satisfies ViewStyle,
  // `.thumb`
  thumb: { width: 64, height: 64, borderRadius: 14, overflow: "hidden" } satisfies ViewStyle,
  thumbImage: { width: 64, height: 64 },
  thumbOverlay: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "flex-end" } satisfies ViewStyle,
  thumbTrack: { alignSelf: "stretch", height: 4, backgroundColor: "rgba(255, 255, 255, 0.35)" } satisfies ViewStyle,
  thumbFill: { height: 4, backgroundColor: "#FFFFFF" } satisfies ViewStyle,
  thumbMark: { ...StyleSheet.absoluteFill, textAlign: "center", textAlignVertical: "center", color: "#FFFFFF", fontFamily: fontFamily.black, fontSize: 24 },
  // `.fchip`
  fchip: {
    height: 64,
    maxWidth: 240,
    paddingHorizontal: 14,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  } satisfies ViewStyle,
  fchipText: { flexShrink: 1 } satisfies ViewStyle,
  fchipName: { fontFamily: fontFamily.extraBold, fontSize: 14 },
  fchipSmall: { fontFamily: fontFamily.bold, fontSize: 12.5 },
  // `.rm`
  rm: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  } satisfies ViewStyle,
  rmText: { fontFamily: fontFamily.black, fontSize: 14, lineHeight: 16, includeFontPadding: false },
  // `textarea`
  input: {
    height: 120,
    borderRadius: 18,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: fontFamily.semiBold,
    fontSize: 16.5,
    lineHeight: 24,
  },
  // `.listen`
  listen: {
    ...StyleSheet.absoluteFill,
    borderRadius: 18,
    borderWidth: 1.5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  } satisfies ViewStyle,
  bar: { width: 5, height: 18, borderRadius: 3 } satisfies ViewStyle,
  listenText: { marginLeft: 10, fontFamily: fontFamily.extraBold, fontSize: 15 },
  // `.tools`, `.tool`
  tools: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 } satisfies ViewStyle,
  tool: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" } satisfies ViewStyle,
  send: { flex: 1, marginLeft: 4 } satisfies ViewStyle,
  toastSlot: { position: "absolute", left: 0, right: 0, bottom: "100%", height: 100, marginBottom: 28 } satisfies ViewStyle,
});
