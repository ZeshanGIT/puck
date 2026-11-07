/** Layout decisions of the alert frame that are plain arithmetic (no React Native), so they can be tested. */

/** Above this phone font scale the options flow with the message in one scroll instead of being pinned. */
export const FLOW_FONT_SCALE = 1.05;
/** A pinned bottom taller than this share of the screen flows too (it would squeeze the message to a sliver). */
export const TALL_BOTTOM_SHARE = 0.5;

/** Whether the options flow inside the scroll (after the message) rather than staying pinned to the bottom. */
export function shouldFlowBottom(input: { fontScale: number; bottomHeight: number; windowHeight: number }): boolean {
  return input.fontScale > FLOW_FONT_SCALE || input.bottomHeight > input.windowHeight * TALL_BOTTOM_SHARE;
}
