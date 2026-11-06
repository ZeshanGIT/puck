// Pure choice of who gets a push. No Convex imports, so `bun test` can run it.
// Token values never leave this module except inside the returned targets.

export interface PushTarget {
  pushToken: string;
  fullScreenAllowed: boolean;
}

export interface PushTargetClient {
  id: string;
  pushToken?: string | null;
  fullScreenAllowed?: boolean | null;
}

export interface PushTargetDevice {
  pushToken?: string | null;
  fullScreenAllowed?: boolean | null;
}

/**
 * Every client with a push token, narrowed to `targetClientId` when it is set, then the legacy
 * device when it has a token that is not already listed. A targeted alert skips the legacy device.
 * Equal tokens count once; the first one listed (a client before the device) wins.
 */
export function selectPushTargets(input: {
  clients: readonly PushTargetClient[];
  device: PushTargetDevice | null;
  targetClientId?: string | null;
}): PushTarget[] {
  const targets: PushTarget[] = [];
  const seen = new Set<string>();
  const targetClientId = input.targetClientId || null;

  for (const client of input.clients) {
    if (!client.pushToken) continue;
    if (targetClientId !== null && client.id !== targetClientId) continue;
    if (seen.has(client.pushToken)) continue;
    seen.add(client.pushToken);
    targets.push({ pushToken: client.pushToken, fullScreenAllowed: client.fullScreenAllowed === true });
  }

  const device = input.device;
  if (targetClientId === null && device?.pushToken && !seen.has(device.pushToken)) {
    targets.push({ pushToken: device.pushToken, fullScreenAllowed: device.fullScreenAllowed === true });
  }
  return targets;
}

/** "push sent to 2 of 3". Counts only. */
export function pushSummary(sent: number, total: number): string {
  return `push sent to ${sent} of ${total}`;
}

/**
 * Whether an alert is for this client. An alert with no target is for everyone.
 */
export function alertIsForClient(targetClientId: string | null | undefined, clientId: string): boolean {
  return !targetClientId || targetClientId === clientId;
}
