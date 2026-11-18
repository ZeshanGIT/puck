package puck.fullscreen

/** MainActivity calls this when Android's app-opening animation ends, so the cover over it can fade. */
object OpenAnimation {
  @JvmStatic
  fun complete() = OverlayCard.enterAnimationComplete()
}
