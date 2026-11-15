package puck.fullscreen

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log

/**
 * Plays an alert's ringtone in Puck itself, as a short foreground service, the way a call or an
 * alarm app rings.
 *
 * Why: the ringtone used to be the alert notification's own sound. Android plays one notification
 * sound at a time, so any other app's notification with a sound (Grok Bot's message, which comes
 * right after its alert) stopped Puck's ringtone and it never resumed. A sound Puck plays itself is
 * at most ducked for a moment by another notification.
 *
 * The service runs only while the ringtone plays: once to the end, or, with Repeat, until `loopMs`.
 * Its notification ("Ringing", with Stop) is on a silent, low channel. JavaScript decides whether to
 * ring at all and on which stream (`ringPlayback.ts`), and stops it wherever it used to cancel the
 * ringing notification. If Android refuses to start the service, [start] returns false and
 * JavaScript lets the notification ring as before.
 */
class RingService : Service() {
  private val main = Handler(Looper.getMainLooper())
  private var player: MediaPlayer? = null
  private var focus: AudioFocusRequest? = null
  private var questionId: String? = null
  private val stopLater = Runnable { finish() }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      finish()
      return START_NOT_STICKY
    }
    val id = intent?.getStringExtra(EXTRA_QUESTION_ID)
    if (id == null) {
      finish()
      return START_NOT_STICKY
    }
    try {
      val notification = buildNotification(intent.getStringExtra(EXTRA_TITLE) ?: "Puck")
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (error: RuntimeException) {
      // Not allowed to be in the foreground now. Ring anyway: the process lives a while longer.
      Log.w(TAG, "ring service could not go to the foreground", error)
    }
    current = this
    play(
      id,
      intent.getStringExtra(EXTRA_SOUND) ?: "",
      intent.getBooleanExtra(EXTRA_ALARM, false),
      intent.getLongExtra(EXTRA_LOOP_MS, -1L),
    )
    return START_NOT_STICKY
  }

  private fun play(id: String, sound: String, alarm: Boolean, loopMs: Long) {
    stopPlayer()
    questionId = id
    val attributes = AudioAttributes.Builder()
      .setUsage(if (alarm) AudioAttributes.USAGE_ALARM else AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    val loop = loopMs > 0
    val next = MediaPlayer()
    try {
      next.setAudioAttributes(attributes)
      next.setWakeMode(applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
      try {
        next.setDataSource(applicationContext, soundUri(sound))
      } catch (error: Exception) {
        // The chosen ringtone is gone: the phone's own one.
        next.reset()
        next.setAudioAttributes(attributes)
        next.setDataSource(applicationContext, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))
      }
      next.isLooping = loop
      next.setOnCompletionListener { if (!loop) finish() }
      next.setOnErrorListener { _, _, _ -> finish(); true }
      next.setOnPreparedListener {
        requestFocus(attributes)
        it.start()
      }
      next.prepareAsync()
      player = next
    } catch (error: Exception) {
      Log.w(TAG, "could not play the ringtone", error)
      next.release()
      finish()
      return
    }
    main.removeCallbacks(stopLater)
    main.postDelayed(stopLater, if (loop) loopMs else MAX_ONCE_MS)
  }

  /**
   * Asks for audio focus, so music pauses while the alert rings, as for a call. Losing it to
   * another notification's sound changes nothing here: the ringtone carries on (at most ducked).
   */
  private fun requestFocus(attributes: AudioAttributes) {
    val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        .setAudioAttributes(attributes)
        .setOnAudioFocusChangeListener { }
        .build()
      audio.requestAudioFocus(request)
      focus = request
    }
  }

  private fun stopPlayer() {
    player?.let {
      try {
        it.stop()
      } catch (_: IllegalStateException) {
        // Not started yet.
      }
      it.release()
    }
    player = null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      focus?.let { (getSystemService(Context.AUDIO_SERVICE) as AudioManager).abandonAudioFocusRequest(it) }
    }
    focus = null
  }

  /** Stops the ringtone, the notification and the service. */
  private fun finish() {
    main.removeCallbacks(stopLater)
    stopPlayer()
    questionId = null
    if (current === this) current = null
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE)
      else @Suppress("DEPRECATION") stopForeground(true)
    } catch (_: RuntimeException) {
    }
    stopSelf()
  }

  override fun onDestroy() {
    main.removeCallbacks(stopLater)
    stopPlayer()
    if (current === this) current = null
    super.onDestroy()
  }

  private fun buildNotification(title: String): Notification {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Ringing now", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Shown while an alert's ringtone plays, with a button to stop it."
          setSound(null, null)
          enableVibration(false)
          setShowBadge(false)
        },
      )
    }
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val stop = PendingIntent.getService(this, 1, Intent(this, RingService::class.java).setAction(ACTION_STOP), flags)
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 2, it, flags)
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION") Notification.Builder(this)
    }
    return builder
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle(title)
      .setContentText("Ringing")
      .setOngoing(true)
      .setContentIntent(open)
      .addAction(Notification.Action.Builder(null, "Stop", stop).build())
      .build()
  }

  private fun soundUri(value: String): Uri =
    if (value.isBlank()) RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE) else Uri.parse(value)

  companion object {
    private const val TAG = "PuckRing"
    private const val CHANNEL_ID = "puck-ringing-now"
    private const val NOTIFICATION_ID = 0x50756b // "Puk"
    private const val ACTION_STOP = "puck.ring.STOP"
    private const val EXTRA_QUESTION_ID = "questionId"
    private const val EXTRA_SOUND = "sound"
    private const val EXTRA_ALARM = "alarm"
    private const val EXTRA_LOOP_MS = "loopMs"
    private const val EXTRA_TITLE = "title"
    // A ringtone played once stops by itself; this only guards against one that never ends.
    private const val MAX_ONCE_MS = 5 * 60_000L

    @Volatile private var current: RingService? = null

    /**
     * Starts ringing for an alert: `sound` is a ringtone URI ("" for the phone's own), `alarm` the
     * alarm stream (through silent mode or Do Not Disturb), `loopMs` how long Repeat lasts (0 or
     * less: play once). Replaces any ring already playing. False when Android would not start it.
     */
    fun start(context: Context, questionId: String, sound: String, alarm: Boolean, loopMs: Long, title: String): Boolean {
      val intent = Intent(context, RingService::class.java)
        .putExtra(EXTRA_QUESTION_ID, questionId)
        .putExtra(EXTRA_SOUND, sound)
        .putExtra(EXTRA_ALARM, alarm)
        .putExtra(EXTRA_LOOP_MS, loopMs)
        .putExtra(EXTRA_TITLE, title)
      return try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
        else context.startService(intent)
        true
      } catch (error: RuntimeException) {
        // ForegroundServiceStartNotAllowedException and friends: let the notification ring.
        Log.w(TAG, "ring service not started", error)
        false
      }
    }

    /** Stops the ringtone when it is this alert's (any alert's when `questionId` is null). */
    fun stop(questionId: String?) {
      Handler(Looper.getMainLooper()).post {
        val service = current ?: return@post
        if (questionId == null || questionId == service.questionId) service.finish()
      }
    }

    /** The alert whose ringtone is playing, if any. */
    fun ringing(): String? = current?.questionId
  }
}
