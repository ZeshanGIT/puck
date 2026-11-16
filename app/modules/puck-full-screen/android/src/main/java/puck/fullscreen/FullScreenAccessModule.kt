package puck.fullscreen

import android.app.Activity
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.app.Activity.RESULT_OK
import android.app.ActivityManager
import android.content.Intent
import android.graphics.Color
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
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
 * - createRingChannel: a channel that plays a chosen ringtone, on the ring stream or on the alarm
 *   stream (so it rings in silent mode).
 * - pickRingtone / ringtoneTitle: the system ringtone picker, and a ringtone's name.
 * - isAppInForeground / isScreenOn: whether Puck is already on screen, so the card stays away.
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
      OverlayCard.onAction = { questionId, action, text, nonce, optionIds ->
        sendEvent(
          "onOverlayAction",
          mapOf("questionId" to questionId, "action" to action, "text" to text, "nonce" to nonce.toDouble(), "optionIds" to optionIds),
        )
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

    // A channel that plays `soundUri` (the phone's default ringtone when empty), once. `stream` is
    // "ring" (follows the ring volume, silent mode mutes it) or "alarm" (the alarm audio stream, so
    // silent and vibrate mode do not mute it). Optionally also set to override Do Not Disturb (Puck
    // needs Do Not Disturb access for that to apply). A channel's settings are fixed once it exists,
    // so each combination, ringtone included, has its own id. Without headsUp the channel is DEFAULT
    // importance: it keeps the sound but no heads-up banner, so the banner cannot cover the card.
    // Returns false when the channel could not be created (Android 7 and older, or an error).
    Function("createRingChannel") { id: String, name: String, soundUri: String, stream: String, bypassDnd: Boolean, headsUp: Boolean ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function false
      val context = appContext.reactContext ?: return@Function false
      try {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val sound = ringtoneUri(soundUri)
        val alarm = stream == "alarm"
        val attributes = AudioAttributes.Builder()
          .setUsage(if (alarm) AudioAttributes.USAGE_ALARM else AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
          .setContentType(if (alarm) AudioAttributes.CONTENT_TYPE_SONIFICATION else AudioAttributes.CONTENT_TYPE_MUSIC)
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

    // Opens the system ringtone picker (the ringtone collection, not the notification tones) and
    // resolves with the chosen ringtone's URI, or null when the person backed out.
    AsyncFunction("pickRingtone") { currentUri: String, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      try {
        val intent = Intent(RingtoneManager.ACTION_RINGTONE_PICKER).apply {
          putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_RINGTONE)
          putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true)
          putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false)
          putExtra(RingtoneManager.EXTRA_RINGTONE_DEFAULT_URI, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))
          putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, ringtoneUri(currentUri))
        }
        pickerPromise?.resolve(null)
        pickerPromise = promise
        activity.startActivityForResult(intent, PICK_RINGTONE_REQUEST)
      } catch (error: Exception) {
        pickerPromise = null
        promise.resolve(null)
      }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode == PICK_RINGTONE_REQUEST) {
        val promise = pickerPromise
        pickerPromise = null
        val picked = if (payload.resultCode == RESULT_OK) pickedUri(payload.data) else null
        promise?.resolve(picked?.toString())
      }
    }

    // The ringtone's name as the system shows it ("Default ringtone (Flutey Phone)" for the default).
    Function("ringtoneTitle") { soundUri: String ->
      val context = appContext.reactContext ?: return@Function null
      try {
        RingtoneManager.getRingtone(context, ringtoneUri(soundUri))?.getTitle(context)
      } catch (error: Exception) {
        null
      }
    }

    // True when Puck's battery use is Unrestricted (not subject to battery optimization), which is
    // what lets an alert through while the phone is idle. Needs no permission.
    Function("isBatteryUnrestricted") {
      val context = appContext.reactContext ?: return@Function false
      val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      power.isIgnoringBatteryOptimizations(context.packageName)
    }

    // True while a Puck screen is on the display. The compact card has no business over Puck itself.
    Function("isAppInForeground") {
      if (Presence.inFront) return@Function true
      // Also asks Android, for an activity that was already on screen before this module started.
      val info = ActivityManager.RunningAppProcessInfo()
      ActivityManager.getMyMemoryState(info)
      info.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    }

    // True while the screen is on. A screen that is off is woken by the full-screen alert instead.
    Function("isScreenOn") {
      val context = appContext.reactContext ?: return@Function true
      (context.getSystemService(Context.POWER_SERVICE) as PowerManager).isInteractive
    }

    // Starts reporting volume key presses in the current window. Also done each time the app
    // comes to the front, because an alert can open a new activity (and a new window).
    Function("watchVolumeKeys") {
      appContext.currentActivity?.let { watchVolumeKeys(it) }
      true
    }

    OnActivityEntersForeground {
      Presence.inFront = true
      // Puck is on screen now (the person opened it, or a full-screen alert did): the card is not needed.
      OverlayCard.hide(null)
      appContext.currentActivity?.let { watchVolumeKeys(it) }
    }

    OnActivityEntersBackground {
      Presence.inFront = false
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
            "nonce" to intent.getLongExtra(OverlayCard.EXTRA_NONCE, 0L).toDouble(),
          ),
        )
      }
    }

    // True when Puck may draw the compact alert card over other apps (the person grants it).
    // A bot's live task floating over other apps (LiveFloat). JavaScript checks the bot's setting.
    Function("showLiveFloat") { spec: Map<String, Any?> ->
      val context = appContext.reactContext ?: return@Function false
      fun text(key: String): String = spec[key] as? String ?: throw IllegalArgumentException(key)
      fun colour(key: String): Int = Color.parseColor(text(key))
      try {
        LiveFloat.show(
          context,
          LiveFloat.Spec(
            activityId = text("activityId"),
            botName = text("botName"),
            title = text("title"),
            stepLine = text("stepLine"),
            note = (spec["note"] as? String)?.takeIf { it.isNotBlank() },
            state = text("state"),
            stepKey = text("stepKey"),
            progress = (spec["progress"] as? Number)?.toFloat(),
            background = colour("background"),
            ink = colour("ink"),
            ink2 = colour("ink2"),
            botColour = colour("botColour"),
            blobFill = colour("blobFill"),
            blobRim = (spec["blobRim"] as? String)?.takeIf { it.isNotEmpty() }?.let { Color.parseColor(it) },
            blobPath = text("blobPath"),
            blobTilt = (spec["blobTilt"] as? Number)?.toFloat() ?: 0f,
            ok = colour("ok"),
            danger = colour("danger"),
          ),
        )
        true
      } catch (error: IllegalArgumentException) {
        false
      }
    }

    Function("hideLiveFloat") { activityId: String? ->
      val context = appContext.reactContext ?: return@Function null
      LiveFloat.hide(activityId)
      null
    }

    Function("canDrawOverlay") {
      val context = appContext.reactContext ?: return@Function false
      OverlayCard.canDraw(context)
    }

    // Shows the compact card for one alert, replacing any card already up. False without the permission.
    Function("showOverlayCard") { card: Map<String, Any?> ->
      val context = appContext.reactContext ?: return@Function false
      fun text(key: String): String = card[key] as? String ?: throw IllegalArgumentException(key)
      try {
        OverlayCard.show(
          context,
          OverlayCard.Spec(
            questionId = text("questionId"),
            label = text("label"),
            title = text("title"),
            body = text("body"),
            background = Color.parseColor(text("background")),
            ink = Color.parseColor(text("ink")),
            ink2 = Color.parseColor(text("ink2")),
            accent = Color.parseColor(text("accent")),
            botColour = Color.parseColor(text("botColour")),
            botDeep = Color.parseColor(text("botDeep")),
            onBot = Color.parseColor(text("onBot")),
            blobFill = Color.parseColor(text("blobFill")),
            blobRim = (card["blobRim"] as? String)?.takeIf { it.isNotEmpty() }?.let { Color.parseColor(it) },
            blobPath = text("blobPath"),
            blobTilt = (card["blobTilt"] as? Number)?.toFloat() ?: 0f,
            screen = Color.parseColor(text("screen")),
            edge = (card["edge"] as? String)?.takeIf { it.isNotEmpty() }?.let { Color.parseColor(it) },
            wash = (card["wash"] as? String)?.takeIf { it.isNotEmpty() }?.let { Color.parseColor(it) },
          ),
        )
      } catch (error: IllegalArgumentException) {
        false
      }
    }

    AsyncFunction("showOverlayCardAsync") { card: Map<String, Any?>, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) { promise.resolve(false) }
      else {
        fun text(key: String): String = card[key] as? String ?: throw IllegalArgumentException(key)
        try {
          OverlayCard.show(context, OverlayCard.Spec(
            questionId = text("questionId"),
            label = text("label"),
            title = text("title"),
            body = text("body"),
            background = Color.parseColor(text("background")),
            ink = Color.parseColor(text("ink")),
            ink2 = Color.parseColor(text("ink2")),
            accent = Color.parseColor(text("accent")),
            botColour = Color.parseColor(text("botColour")),
            botDeep = Color.parseColor(text("botDeep")),
            onBot = Color.parseColor(text("onBot")),
            blobFill = Color.parseColor(text("blobFill")),
            blobRim = (card["blobRim"] as? String)?.takeIf { it.isNotEmpty() }?.let { Color.parseColor(it) },
            blobPath = text("blobPath"),
            blobTilt = (card["blobTilt"] as? Number)?.toFloat() ?: 0f,
            screen = Color.parseColor(text("screen")),
            edge = (card["edge"] as? String)?.takeIf { it.isNotEmpty() }?.let { Color.parseColor(it) },
            wash = (card["wash"] as? String)?.takeIf { it.isNotEmpty() }?.let { Color.parseColor(it) },
          )) { shown -> promise.resolve(shown) }
        } catch (_: IllegalArgumentException) { promise.resolve(false) }
      }
    }

    Function("peekOverlayOpen") {
      OverlayCard.peekOpened()?.let { opened ->
        mapOf("questionId" to opened.questionId, "snooze" to opened.snooze, "snoozeMinutes" to opened.snoozeMinutes, "nonce" to opened.nonce.toDouble())
      }
    }

    Function("overlayAlertReady") { questionId: String ->
      OverlayCard.alertReady(questionId)
      true
    }

    Function("reportAlertBlob") { x: Double, y: Double, size: Double ->
      val context = appContext.reactContext ?: return@Function false
      OverlayCard.rememberAlertBlob(context, x.toFloat(), y.toFloat(), size.toFloat())
      true
    }

    // Puck plays the alert's ringtone itself (RingService). False: Android would not start it.
    Function("startRing") { questionId: String, sound: String, alarm: Boolean, loopMs: Double, title: String ->
      val context = appContext.reactContext ?: return@Function false
      RingService.start(context, questionId, sound, alarm, loopMs.toLong(), title)
    }

    // Stops the ringtone when it is this alert's; "" stops any.
    Function("stopRing") { questionId: String ->
      RingService.stop(questionId.ifEmpty { null })
      true
    }

    // The phone's ringer mode and whether Do Not Disturb is on, for deciding whether Puck rings.
    Function("soundPolicy") {
      val context = appContext.reactContext ?: return@Function null
      val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      val notifications = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val filter = notifications.currentInterruptionFilter
      mapOf(
        "ringer" to when (audio.ringerMode) {
          AudioManager.RINGER_MODE_NORMAL -> "normal"
          AudioManager.RINGER_MODE_VIBRATE -> "vibrate"
          else -> "silent"
        },
        "dnd" to (filter != NotificationManager.INTERRUPTION_FILTER_ALL && filter != NotificationManager.INTERRUPTION_FILTER_UNKNOWN),
      )
    }

    Function("openAlertFullScreen") { questionId: String ->
      val context = appContext.reactContext ?: return@Function false
      OverlayCard.openFullScreen(context, questionId)
    }

    Function("takeOverlayBlobFlight") {
      OverlayCard.takeBlobFlight()
    }

    // Removes the compact card when it shows this alert (or whichever card, with an empty id).
    // The answers the card offers when swiped up, as JSON (`cardChoices.ts`).
    Function("setOverlayChoices") { questionId: String, json: String ->
      OverlayCard.setChoices(questionId, json)
      true
    }

    Function("hideOverlayCard") { questionId: String ->
      OverlayCard.hide(questionId.ifEmpty { null })
      true
    }

    // Replies typed on the compact card that JavaScript has not taken yet (kept across a closed app).
    Function("pendingOverlayReplies") {
      val context = appContext.reactContext ?: return@Function emptyList<Map<String, Any?>>()
      OverlayCard.pendingReplies(context).map { reply ->
        mapOf("questionId" to reply.questionId, "text" to reply.text, "nonce" to reply.nonce.toDouble(), "optionIds" to reply.optionIds)
      }
    }

    // Forgets one card reply once JavaScript has sent it or queued it.
    Function("clearOverlayReply") { nonce: Double ->
      val context = appContext.reactContext ?: return@Function false
      OverlayCard.clearReply(context, nonce.toLong())
      true
    }

    // The alert a tap on the compact card opened on a cold start, and whether Snooze was chosen; taken once.
    Function("takeOverlayOpen") {
      OverlayCard.takeOpened(appContext.currentActivity?.intent)?.let { opened ->
        mapOf("questionId" to opened.questionId, "snooze" to opened.snooze, "snoozeMinutes" to opened.snoozeMinutes, "nonce" to opened.nonce.toDouble())
      }
    }
  }

  private var pickerPromise: Promise? = null

  private fun ringtoneUri(value: String): Uri =
    if (value.isBlank()) RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE) else Uri.parse(value)

  @Suppress("DEPRECATION")
  private fun pickedUri(data: Intent?): Uri? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      data?.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI, Uri::class.java)
    } else {
      data?.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI)
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

private const val PICK_RINGTONE_REQUEST = 7301

/** Whether a Puck screen is on the display, kept by the activity events so a background alert can read it. */
internal object Presence {
  @Volatile var inFront: Boolean = false
}
