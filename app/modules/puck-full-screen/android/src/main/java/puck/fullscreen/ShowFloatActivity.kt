package puck.fullscreen

import android.app.Activity
import android.os.Bundle

/**
 * The live notification's "Show floating card" opens this invisible activity, which brings the
 * floating card back (`LiveFloat.restore`) and closes at once. It is native because the notification
 * library's own button handling fails in this app (its event never reaches JavaScript), and it does
 * not open Puck: the person stays where they were.
 */
class ShowFloatActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    LiveFloat.restore(applicationContext, null)
    finish()
    @Suppress("DEPRECATION")
    overridePendingTransition(0, 0)
  }
}
