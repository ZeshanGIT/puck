/** Let-go distance, in pixels, from the gesture-choice mockup. A shorter pull springs back. */
export const SWIPE_COMMIT_PX = 68;

/**
 * A real drag starts inside the mark. A touch that is already past it when the
 * screen appears is the tap that opened the app, and must not send an answer.
 */
export function swipeCanBegin(dx: number, dy: number): boolean {
  const distance = Math.abs(dx);
  return distance > 8 && distance < SWIPE_COMMIT_PX && distance > Math.abs(dy);
}

/**
 * The first option sits on the left and the second on the right.
 * A release inside the mark does not commit.
 */
export function swipeChoice(dx: number, options: readonly { id: string }[]): string | null {
  const left = options[0];
  const right = options[1];
  if (!left || !right || options.length !== 2) return null;
  if (dx <= -SWIPE_COMMIT_PX) return left.id;
  if (dx >= SWIPE_COMMIT_PX) return right.id;
  return null;
}
