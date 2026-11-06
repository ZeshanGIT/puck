package puck.fullscreen

import android.app.KeyguardManager
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reads NotificationManager.canUseFullScreenIntent and isNotificationPolicyAccessGranted
 * (Do Not Disturb access). Notifee exposes neither.
 */
class FullScreenAccessModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PuckFullScreenAccess")

    Function("canUse") {
      val context = appContext.reactContext ?: return@Function false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return@Function true
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.canUseFullScreenIntent()
    }

    // True when the person has allowed Puck in the Do Not Disturb access settings.
    Function("hasDndAccess") {
      val context = appContext.reactContext ?: return@Function false
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.isNotificationPolicyAccessGranted
    }

    // The activity is showing over the lock screen. Step back so the lock screen is visible again.
    // The process stays alive. False when the phone is already unlocked.
    Function("leaveIfLocked") {
      val activity = appContext.currentActivity ?: return@Function false
      val keyguard = activity.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
      if (!keyguard.isKeyguardLocked) return@Function false
      activity.runOnUiThread { activity.moveTaskToBack(true) }
      true
    }
  }
}
