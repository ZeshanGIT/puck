package puck.fullscreen

import android.app.Activity
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.RingtoneManager
import android.os.Build
import android.view.KeyEvent
import android.view.Window
import java.util.concurrent.atomic.AtomicBoolean
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reads NotificationManager.canUseFullScreenIntent and isNotificationPolicyAccessGranted
 * (Do Not Disturb access). Notifee exposes neither.
 *
 * Also the pieces of an urgent alert that Notifee cannot do (card T34):
 * - createAlarmChannel: a channel on the alarm audio stream, so it rings in silent mode.
 * - isLocked: the keyguard is showing, so the screen is over the lock screen.
 * - isInCall: the phone is in a call (no permission needed: AudioManager.getMode()).
 * - volume keys: an "onVolumeKey" event when a volume key goes down in the app's window, so a
 *   ringing alert can be silenced without being answered. The key is not swallowed.
 *
 * Unlock gating (card T37):
 * - requestUnlock: asks the system to dismiss the keyguard (fingerprint or PIN where set).
 */
class FullScreenAccessModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PuckFullScreenAccess")

    Events("onVolumeKey", "onOverlayOpen", "onOverlayAction")

    OnCreate {
      OverlayCard.onAction = { questionId, action ->
        sendEvent("onOverlayAction", mapOf("questionId" to questionId, "action" to action))
      }
    }

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

    // Sends Puck's task to the back so the app he was in (or the home screen) shows again, whether
    // or not the phone is locked. The process stays alive. False when there is no activity.
    Function("goBack") {
      val activity = appContext.currentActivity ?: return@Function false
      activity.runOnUiThread { activity.moveTaskToBack(true) }
      true
    }

    // True while the lock screen (keyguard) is showing, which is when an alert covers it.
    Function("isLocked") {
      val context = appContext.reactContext ?: return@Function false
      val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
      keyguard.isKeyguardLocked
    }

    // Asks the system to dismiss the keyguard for the current activity (which must be showing over
    // it, as an urgent alert is). Resolves "unlocked" (also at once when not locked, and with no
    // prompt on a swipe lock), "cancelled" (the person backed out) or "error" (no activity, or
    // the system refused). Settles once only.
    AsyncFunction("requestUnlock") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve("error")
        return@AsyncFunction
      }
      try {
        val keyguard = activity.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        if (!keyguard.isKeyguardLocked) {
          promise.resolve("unlocked")
          return@AsyncFunction
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
          promise.resolve("error")
          return@AsyncFunction
        }
        val settled = AtomicBoolean(false)
        val settle = { result: String -> if (settled.compareAndSet(false, true)) promise.resolve(result) }
        activity.runOnUiThread {
          try {
            keyguard.requestDismissKeyguard(
              activity,
              object : KeyguardManager.KeyguardDismissCallback() {
                override fun onDismissSucceeded() = settle("unlocked")
                override fun onDismissCancelled() = settle("cancelled")
                override fun onDismissError() = settle("error")
              },
            )
          } catch (error: Exception) {
            settle("error")
          }
        }
      } catch (error: Exception) {
        promise.resolve("error")
      }
    }

    // True during a phone call, an incoming call ringing, or a voice or video call in another
    // app. The audio mode needs no permission, unlike the phone state listener (READ_PHONE_STATE).
    Function("isInCall") {
      val context = appContext.reactContext ?: return@Function false
      val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      when (audio.mode) {
        AudioManager.MODE_IN_CALL,
        AudioManager.MODE_IN_COMMUNICATION,
        AudioManager.MODE_RINGTONE,
        AudioManager.MODE_CALL_SCREENING -> true
        else -> false
      }
    }

    // A channel whose sound plays on the alarm stream, so silent and vibrate mode do not mute it.
    // Optionally also set to override Do Not Disturb (Puck needs Do Not Disturb access for that to
    // apply). A channel's settings are fixed once it exists, so each combination has its own id.
    // Without headsUp the channel is DEFAULT importance: it keeps the sound but no heads-up banner,
    // so the banner cannot cover the compact card.
    // Returns false when the channel could not be created (Android 7 and older, or an error).
    Function("createAlarmChannel") { id: String, name: String, bypassDnd: Boolean, headsUp: Boolean ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function false
      val context = appContext.reactContext ?: return@Function false
      try {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
          ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        val attributes = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ALARM)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
        val importance = if (headsUp) NotificationManager.IMPORTANCE_HIGH else NotificationManager.IMPORTANCE_DEFAULT
        val channel = NotificationChannel(id, name, importance)
        channel.setSound(sound, attributes)
        channel.enableVibration(true)
        channel.vibrationPattern = longArrayOf(0, 500, 400, 500)
        channel.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        channel.setBypassDnd(bypassDnd)
        manager.createNotificationChannel(channel)
        true
      } catch (error: Exception) {
        false
      }
    }

    // Starts reporting volume key presses in the current window. Also done each time the app
    // comes to the front, because an alert can open a new activity (and a new window).
    Function("watchVolumeKeys") {
      appContext.currentActivity?.let { watchVolumeKeys(it) }
      true
    }

    OnActivityEntersForeground {
      appContext.currentActivity?.let { watchVolumeKeys(it) }
    }

    // A tap on the compact card while the app is already running: JavaScript opens that alert.
    OnNewIntent { intent: Intent ->
      intent.getStringExtra(OverlayCard.EXTRA_QUESTION_ID)?.let { id ->
        sendEvent(
          "onOverlayOpen",
          mapOf(
            "questionId" to id,
            "snooze" to intent.getBooleanExtra(OverlayCard.EXTRA_SNOOZE, false),
            "snoozeMinutes" to intent.getIntExtra(OverlayCard.EXTRA_SNOOZE_MINUTES, 0),
          ),
        )
      }
    }

    // True when Puck may draw the compact alert card over other apps (the person grants it).
    Function("canDrawOverlay") {
      val context = appContext.reactContext ?: return@Function false
      OverlayCard.canDraw(context)
    }

    // Shows the compact card for one alert, replacing any card already up. False without the permission.
    Function("showOverlayCard") {
        questionId: String,
        label: String,
        title: String,
        body: String,
        background: String,
        ink: String,
        ink2: String,
        accent: String ->
      val context = appContext.reactContext ?: return@Function false
      try {
        OverlayCard.show(
          context,
          OverlayCard.Spec(
            questionId = questionId,
            label = label,
            title = title,
            body = body,
            background = Color.parseColor(background),
            ink = Color.parseColor(ink),
            ink2 = Color.parseColor(ink2),
            accent = Color.parseColor(accent),
          ),
        )
      } catch (error: IllegalArgumentException) {
        false
      }
    }

    // Removes the compact card when it shows this alert (or whichever card, with an empty id).
    Function("hideOverlayCard") { questionId: String ->
      OverlayCard.hide(questionId.ifEmpty { null })
      true
    }

    // The alert a tap on the compact card opened on a cold start, and whether Snooze was chosen; taken once.
    Function("takeOverlayOpen") {
      OverlayCard.takeOpened(appContext.currentActivity?.intent)?.let { opened ->
        mapOf("questionId" to opened.questionId, "snooze" to opened.snooze, "snoozeMinutes" to opened.snoozeMinutes)
      }
    }
  }

  private fun watchVolumeKeys(activity: Activity) {
    activity.runOnUiThread {
      val window = activity.window
      val current = window.callback
      if (current != null && current !is VolumeKeyCallback) {
        window.callback = VolumeKeyCallback(current) {
          sendEvent("onVolumeKey", mapOf<String, Any?>())
        }
      }
    }
  }
}

/** Wraps the window's callback: tells the module about a volume key, then lets it through. */
private class VolumeKeyCallback(
  private val original: Window.Callback,
  private val onVolumeKey: () -> Unit,
) : Window.Callback by original {
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    val volumeKey =
      event.keyCode == KeyEvent.KEYCODE_VOLUME_UP ||
        event.keyCode == KeyEvent.KEYCODE_VOLUME_DOWN ||
        event.keyCode == KeyEvent.KEYCODE_VOLUME_MUTE
    if (volumeKey && event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) onVolumeKey()
    return original.dispatchKeyEvent(event)
  }
}
