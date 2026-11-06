import { describe, expect, test } from "bun:test";
import { BOT_COLOURS } from "@puck/shared";
import {
  botBlob,
  botTestId,
  bypassChange,
  bypassChoice,
  dateText,
  flockBots,
  mutedBotIds,
  nextMuteExpiry,
  takeoverAlerts,
  isMuted,
  lastPagedText,
  muteUntil,
  mutedLabel,
  nextMorning,
  selectedMuteChip,
  sortBots,
  waitingTag,
  MUTE_CHIPS,
  type BotListItem,
} from "./botsModel";
import { PALETTE } from "./ui/botTheme";

const HOUR = 3_600_000;
/** Saturday 7 Nov 2026, 22:15 local time. */
const NIGHT = new Date(2026, 10, 7, 22, 15).getTime();
/** The same day, 05:30. */
const EARLY = new Date(2026, 10, 7, 5, 30).getTime();

function bot(over: Partial<BotListItem> = {}): BotListItem {
  return {
    botId: "sheldon-00001",
    name: "Sheldon",
    colour: "coral",
    mutedUntil: null,
    createdAt: 1,
    addedFrom: "MacBook",
    lastAlertAt: null,
    waitingCount: 0,
    ...over,
  };
}

describe("mute chips", () => {
  test("the chips are Off, an hour, until tomorrow and a week", () => {
    expect(MUTE_CHIPS.map((chip) => chip.id)).toEqual(["off", "1h", "tomorrow", "week"]);
  });

  test("each stores a future time, and Off stores null", () => {
    expect(muteUntil("off", NIGHT)).toBeNull();
    expect(muteUntil("1h", NIGHT)).toBe(NIGHT + HOUR);
    expect(muteUntil("week", NIGHT)).toBe(NIGHT + 7 * 24 * HOUR);
    for (const chip of MUTE_CHIPS) {
      const until = muteUntil(chip.id, NIGHT);
      expect(until === null || until > NIGHT).toBe(true);
    }
  });

  test("until tomorrow is the next 7:00, which is this morning before 7:00", () => {
    expect(new Date(muteUntil("tomorrow", NIGHT)!)).toEqual(new Date(2026, 10, 8, 7, 0));
    expect(new Date(nextMorning(EARLY))).toEqual(new Date(2026, 10, 7, 7, 0));
    expect(new Date(nextMorning(new Date(2026, 10, 7, 7, 0).getTime()))).toEqual(new Date(2026, 10, 8, 7, 0));
  });

  test("the chip to highlight is read back from the stored time", () => {
    expect(selectedMuteChip(null, NIGHT)).toBe("off");
    expect(selectedMuteChip(NIGHT - 1, NIGHT)).toBe("off");
    expect(selectedMuteChip(muteUntil("1h", NIGHT), NIGHT)).toBe("1h");
    expect(selectedMuteChip(muteUntil("1h", NIGHT), NIGHT + 40 * 60_000)).toBe("1h");
    expect(selectedMuteChip(muteUntil("tomorrow", NIGHT), NIGHT)).toBe("tomorrow");
    expect(selectedMuteChip(muteUntil("week", NIGHT), NIGHT)).toBe("week");
  });

  test("a mute that ends exactly now is over", () => {
    expect(isMuted(NIGHT, NIGHT)).toBe(false);
    expect(isMuted(NIGHT + 1, NIGHT)).toBe(true);
    expect(isMuted(null, NIGHT)).toBe(false);
  });
});

describe("muted label", () => {
  test("today, tomorrow and later", () => {
    expect(mutedLabel(new Date(2026, 10, 7, 23, 15).getTime(), NIGHT)).toBe("Muted until 23:15");
    expect(mutedLabel(new Date(2026, 10, 8, 7, 0).getTime(), NIGHT)).toBe("Muted until tomorrow 7:00");
    expect(mutedLabel(new Date(2026, 10, 14, 22, 15).getTime(), NIGHT)).toBe("Muted until 14 Nov 22:15");
    expect(mutedLabel(new Date(2026, 10, 7, 7, 0).getTime(), EARLY)).toBe("Muted until 7:00");
  });

  test("nothing when not muted", () => {
    expect(mutedLabel(null, NIGHT)).toBeNull();
    expect(mutedLabel(NIGHT - HOUR, NIGHT)).toBeNull();
  });
});

describe("words", () => {
  test("last paged", () => {
    expect(lastPagedText(null, NIGHT)).toBe("Hasn't paged you yet");
    expect(lastPagedText(NIGHT - 10_000, NIGHT)).toBe("Last paged just now");
    expect(lastPagedText(NIGHT - 3 * 60_000, NIGHT)).toBe("Last paged 3 min ago");
    expect(lastPagedText(NIGHT - 5 * HOUR, NIGHT)).toBe("Last paged 5 h ago");
    expect(lastPagedText(NIGHT - 49 * HOUR, NIGHT)).toBe("Last paged 2 d ago");
  });

  test("waiting tag, date, test ids", () => {
    expect(waitingTag(0)).toBeNull();
    expect(waitingTag(2)).toBe("2 waiting");
    expect(dateText(new Date(2026, 10, 7).getTime())).toBe("7 Nov 2026");
    expect(botTestId("bot-row", "Deploy Watch")).toBe("bot-row-deploy-watch");
    expect(botTestId("bot-row", "Sheldon")).toBe("bot-row-sheldon");
  });
});

describe("sorting", () => {
  test("waiting first, then the most recent, never-paged last, then by name", () => {
    const a = bot({ botId: "a-00001", name: "Alpha", lastAlertAt: 100 });
    const b = bot({ botId: "b-00002", name: "Beta", lastAlertAt: 500 });
    const c = bot({ botId: "c-00003", name: "Cora", lastAlertAt: null });
    const d = bot({ botId: "d-00004", name: "Dee", lastAlertAt: 50, waitingCount: 2 });
    const e = bot({ botId: "e-00005", name: "Abe", lastAlertAt: null });
    expect(sortBots([a, b, c, d, e]).map((x) => x.name)).toEqual(["Dee", "Beta", "Alpha", "Abe", "Cora"]);
  });

  test("does not change its input", () => {
    const list = [bot({ name: "B" }), bot({ name: "A", botId: "a-00002" })];
    sortBots(list);
    expect(list[0]!.name).toBe("B");
  });
});

describe("look and colours", () => {
  test("a bot keeps its own colour, and is given one when it has none", () => {
    expect(botBlob(bot({ colour: "teal" })).colour).toBe("teal");
    expect(PALETTE.some((entry) => entry.name === botBlob(bot({ colour: null })).colour)).toBe(true);
  });

  test("the swatches (the palette) are exactly the colours the backend accepts", () => {
    expect(PALETTE.map((entry) => entry.name)).toEqual([...BOT_COLOURS]);
  });
});

describe("bypass chips", () => {
  test("default means no override", () => {
    expect(bypassChoice(undefined, "dnd")).toBe("default");
    expect(bypassChoice({ silent: "all" }, "dnd")).toBe("default");
    expect(bypassChoice({ dnd: "off", silent: "all" }, "silent")).toBe("all");
    expect(bypassChange("default")).toBeNull();
    expect(bypassChange("urgent")).toBe("urgent");
  });
});

describe("home flock", () => {
  test("one blob per bot, oldest first, with its own colour", () => {
    const flock = flockBots([
      bot({ botId: "b-00002", name: "Beta", colour: "teal", createdAt: 20 }),
      bot({ botId: "a-00001", name: "Alpha", colour: null, createdAt: 10 }),
    ]);
    expect(flock).toEqual([
      { botId: "a-00001", botName: "Alpha" },
      { botId: "b-00002", botName: "Beta", colour: "teal" },
    ]);
    expect(flockBots([])).toEqual([]);
  });
});

describe("muted bots and the deck", () => {
  const alerts = [
    { questionId: "q_1", botId: "sheldon-00001" },
    { questionId: "q_2", botId: "brow-00007" },
    { questionId: "q_3", botId: "brow-00007" },
  ];
  const bots = [
    { botId: "sheldon-00001", mutedUntil: null },
    { botId: "brow-00007", mutedUntil: NIGHT + HOUR },
  ];

  test("the muted set is the bots whose mute is still in force", () => {
    expect([...mutedBotIds(bots, NIGHT)]).toEqual(["brow-00007"]);
    expect(mutedBotIds(bots, NIGHT + HOUR).size).toBe(0);
    expect(mutedBotIds(bots, NIGHT + 2 * HOUR).size).toBe(0);
  });

  test("a muted bot's alerts stay out of the deck, so they do not count toward a stack", () => {
    const deck = takeoverAlerts(alerts, mutedBotIds(bots, NIGHT), null)!;
    expect(deck.map((a) => a.questionId)).toEqual(["q_1"]);
    expect(deck.length >= 2).toBe(false);
  });

  test("an alert he chose shows even when its bot is muted, and only that one", () => {
    const deck = takeoverAlerts(alerts, mutedBotIds(bots, NIGHT), "q_3")!;
    expect(deck.map((a) => a.questionId)).toEqual(["q_1", "q_3"]);
  });

  test("when the mute ends the alerts come back", () => {
    expect(takeoverAlerts(alerts, mutedBotIds(bots, NIGHT + HOUR), null)!.length).toBe(3);
  });

  test("nothing muted, or still loading", () => {
    expect(takeoverAlerts(alerts, new Set(), null)).toEqual(alerts);
    expect(takeoverAlerts(undefined, new Set(["brow-00007"]), null)).toBeUndefined();
  });

  test("the inbox looks again when the soonest mute ends", () => {
    expect(nextMuteExpiry(bots, NIGHT)).toBe(NIGHT + HOUR);
    expect(nextMuteExpiry([{ mutedUntil: NIGHT + 5 * HOUR }, { mutedUntil: NIGHT + HOUR }, { mutedUntil: null }], NIGHT)).toBe(NIGHT + HOUR);
    expect(nextMuteExpiry(bots, NIGHT + HOUR)).toBeNull();
    expect(nextMuteExpiry([], NIGHT)).toBeNull();
  });
});
