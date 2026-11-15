package puck.fullscreen

import android.animation.ArgbEvaluator
import android.animation.ValueAnimator
import android.app.KeyguardManager
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.text.InputType
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.graphics.ColorUtils
import androidx.core.graphics.PathParser
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sign
import kotlin.random.Random

/**
 * The compact alert card, drawn over other apps. It needs the overlay permission the person grants
 * on Android's "Display over other apps" page; without it nothing is drawn and the notification
 * carries the alert alone. One card at a time. It takes focus only while a reply is being typed, and
 * touches outside it reach the app underneath. The card wears the bot: its blob (with eyes that
 * glance and blink) and a wash of its colour. Gestures:
 *
 * - Tap: opens Puck on that alert.
 * - Pull down: the card grows with the finger into a full-screen sheet (white, or dark in the dark
 *   theme). The sheet turns white by a fifth of the way down the screen. Let go past 40% of the way
 *   and the transition finishes by itself while Puck opens beneath it; let go before that and the
 *   card springs back.
 * - Swipe left: snoozes. The card slides aside and the length shows under it in the bot's colour:
 *   5 minutes, then 10 minutes, then until the person is back. Lifting the finger picks the length
 *   showing; a short swipe springs back and does nothing.
 * - Swipe right: reveals a reply area underneath. Let go past a quarter of the width and the card
 *   steps away, the keyboard opens, and Send answers the alert without opening Puck. Cancel brings
 *   the card back.
 * - Swipe up: removes the card and stops the ring. The alert stays in the shade.
 */
internal object OverlayCard {
  const val EXTRA_QUESTION_ID = "puck.overlayQuestionId"
  const val EXTRA_SNOOZE = "puck.overlaySnooze"
  const val EXTRA_SNOOZE_MINUTES = "puck.overlaySnoozeMinutes"
  const val EXTRA_NONCE = "puck.overlayNonce"
  const val ACTION_DISMISS = "dismiss"
  const val ACTION_SNOOZE = "snooze"
  const val ACTION_REPLY = "reply"

  /** Sent as the snooze length for "until I'm back"; 0 means "show the snooze choices". */
  const val SNOOZE_UNTIL_BACK = -1
  const val SNOOZE_CHOICES = 0

  // How far a sideways drag has gone to the left, as a share of the card's width, where each length starts.
  private const val FIVE_MIN_FRACTION = 0.12f
  private const val TEN_MIN_FRACTION = 0.38f
  private const val UNTIL_BACK_FRACTION = 0.65f

  // A swipe right past this share of the card's width opens the reply area.
  private const val REPLY_FRACTION = 0.25f

  // Pull down: the sheet is white by COLOUR_DONE of the way to the bottom of the screen. Released
  // past COMMIT_FRACTION of the way, the rest of the transition finishes by itself.
  private const val COLOUR_DONE = 0.2f
  private const val COMMIT_FRACTION = 0.4f

  private const val SETTLE_MS = 150L
  private const val COVER_HOLD_MS = 380L
  private const val COVER_FADE_MS = 320L
  private const val COVER_SAFETY_MS = 4000L
  private const val FLING_UP = -1200f
  private const val FLING_DOWN = 1500f
  private const val TOP_MARGIN_DP = 44
  private const val ROOM_BELOW_DP = 72
  // Room around the card for its shadow, so the window never clips it. The shadow of ELEVATION_DP
  // spreads about this far below the card.
  private const val SHADOW_DP = 20
  private const val ELEVATION_DP = 10
  private const val CORNER_DP = 22
  // The edge just inside the card's outline, so it stands apart from a busy wallpaper (NeedCard's 1.5 dp).
  private const val EDGE_DP = 1.5f

  private const val PREFS = "puck.overlayCard"
  private const val REPLIES_KEY = "pendingReplies"

  data class Spec(
    val questionId: String,
    val label: String,
    val title: String,
    val body: String,
    val background: Int,
    val ink: Int,
    val ink2: Int,
    val accent: Int,
    val botColour: Int,
    val botDeep: Int,
    val onBot: Int,
    val blobFill: Int,
    val blobRim: Int?,
    val blobPath: String,
    val blobTilt: Float,
    val screen: Int,
    /** The card's edge. Null: a see-through line of the ink. */
    val edge: Int? = null,
  )

  /**
   * A request to open Puck on an alert. `nonce` is unique per request, so JavaScript can tell the
   * same request arriving by two routes (the new-intent event and `takeOpened`) and act on it once.
   */
  data class Opened(val questionId: String, val snooze: Boolean, val snoozeMinutes: Int, val nonce: Long)

  /** A reply typed on the card, kept on the phone until JavaScript has sent it. */
  data class CardReply(val questionId: String, val text: String, val nonce: Long)

  /**
   * Set by the module: reports a dismiss, snooze or reply to JavaScript while the app is running.
   * `text` and `nonce` are set only for a reply (`nonce` is 0 for the other actions).
   */
  @Volatile var onAction: ((questionId: String, action: String, text: String?, nonce: Long) -> Unit)? = null

  private val main = Handler(Looper.getMainLooper())
  private var view: View? = null
  private var params: WindowManager.LayoutParams? = null
  private var cover: View? = null
  private var shownId: String? = null
  private var openingId: String? = null
  private var openingReady = false
  private var openingAnimating = false

  fun peekOpened(): Opened? = pendingOpen?.takeIf {
    SystemClock.elapsedRealtime() - pendingAt < PENDING_OPEN_MS
  }

  fun alertReady(questionId: String) {
    main.post {
      if (openingId != questionId) return@post
      pendingOpen = null
      openingReady = true
      if (!openingAnimating) cover?.let { fadeOutCover(it) }
    }
  }

  /**
   * Nunito, the app's font, in the weights the card uses. The files sit in this module's Android
   * assets (`puck-fonts/`), copied from `@expo-google-fonts/nunito`, because the native card cannot
   * reach the fonts the JavaScript side loads. A face that does not load falls back to the system
   * font in the nearest style.
   */
  private enum class Nunito(val file: String, val fallback: Int) {
    BOLD("Nunito_700Bold.ttf", Typeface.BOLD),
    EXTRA_BOLD("Nunito_800ExtraBold.ttf", Typeface.BOLD),
    BLACK("Nunito_900Black.ttf", Typeface.BOLD),
  }

  private val faces = HashMap<Nunito, Typeface>()

  private fun font(context: Context, weight: Nunito): Typeface = faces.getOrPut(weight) {
    try {
      Typeface.createFromAsset(context.applicationContext.assets, "puck-fonts/${weight.file}")
    } catch (error: RuntimeException) {
      Typeface.create(Typeface.DEFAULT, weight.fallback)
    }
  }

  private fun edgeColour(card: Spec): Int =
    card.edge ?: ColorUtils.setAlphaComponent(card.ink, 0x2E)

  private fun motionEnabled(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.O || ValueAnimator.areAnimatorsEnabled()


  // The last open request, kept until JavaScript takes it or it goes stale. A new-intent event is
  // lost when no screen is listening yet (Puck was idle or just restarted), and the activity's own
  // intent is not replaced when Puck is reused, so the request is also held here.
  private const val PENDING_OPEN_MS = 10_000L
  private val nonces = java.util.concurrent.atomic.AtomicLong(System.currentTimeMillis())
  @Volatile private var pendingOpen: Opened? = null
  @Volatile private var pendingAt = 0L

  /**
   * The snooze length a sideways drag to the left of `fraction` of the card's width would pick: 0
   * before the first mark (nothing yet), then 5, 10, or [SNOOZE_UNTIL_BACK].
   */
  fun snoozeMinutesFor(fraction: Float): Int = when {
    fraction < FIVE_MIN_FRACTION -> 0
    fraction < TEN_MIN_FRACTION -> 5
    fraction < UNTIL_BACK_FRACTION -> 10
    else -> SNOOZE_UNTIL_BACK
  }

  // Where the full-screen alert draws the bot's blob, in dp, as the alert screen last reported it.
  private const val BLOB_X = "alertBlobX"
  private const val BLOB_Y = "alertBlobY"
  private const val BLOB_SIZE = "alertBlobSize"
  // The alert screen's blob when it has never reported one (AlertFrame's default).
  private const val ALERT_BLOB_DP = 156

  /** When a card opening last flew its blob into the app; the alert skips its arrival once for it. */
  @Volatile private var blobFlownAt = 0L

  fun rememberAlertBlob(context: Context, x: Float, y: Float, size: Float) {
    prefs(context).edit().putFloat(BLOB_X, x).putFloat(BLOB_Y, y).putFloat(BLOB_SIZE, size).apply()
  }

  /** True once, within a few seconds of a card flying its blob into the app. */
  fun takeBlobFlight(): Boolean {
    val at = blobFlownAt
    blobFlownAt = 0L
    return at != 0L && SystemClock.elapsedRealtime() - at < 5_000L
  }

  /**
   * Where the alert screen's blob is, in screen pixels: as last reported, or, before the alert has
   * ever been shown, where AlertFrame puts it (centred, under the status bar and the top row).
   */
  private fun alertBlobTarget(context: Context): RectF {
    val density = context.resources.displayMetrics.density
    val saved = prefs(context)
    if (saved.contains(BLOB_SIZE)) {
      val x = saved.getFloat(BLOB_X, 0f) * density
      val y = saved.getFloat(BLOB_Y, 0f) * density
      val size = saved.getFloat(BLOB_SIZE, 0f) * density
      if (size > 0f) return RectF(x, y, x + size, y + size)
    }
    val size = ALERT_BLOB_DP * density
    val statusBar = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      windowManager(context).currentWindowMetrics.windowInsets
        .getInsets(android.view.WindowInsets.Type.statusBars()).top.toFloat()
    } else {
      24 * density
    }
    val x = (screenSize(context).first - size) / 2f
    val y = statusBar + (8 + 26 + 18) * density
    return RectF(x, y, x + size, y + size)
  }

  fun canDraw(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)

  fun show(context: Context, card: Spec, result: ((Boolean) -> Unit)? = null): Boolean {
    if (!canDraw(context)) { result?.invoke(false); return false }
    val app = context.applicationContext
    main.post {
      val keyguard = app.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
      if (!canDraw(app) || keyguard.isKeyguardLocked) {
        result?.invoke(false)
        return@post
      }
      // Puck came to the front (a full-screen alert, or the person opened it) while this card was on
      // its way: the card is not needed. Counts as handled, so no second ring is posted for it.
      if (Presence.inFront) {
        result?.invoke(true)
        return@post
      }
      removeView()
      cover?.let { removeCover(it) }
      val root = buildView(app, card)
      val layoutParams = WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        overlayType(),
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
          WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
          WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT,
      ).apply {
        gravity = Gravity.TOP
        // The window starts above the card by the shadow room, so the card itself sits at the top margin.
        y = dp(app, TOP_MARGIN_DP - SHADOW_DP)
      }
      try {
        windowManager(app).addView(root, layoutParams)
        view = root
        params = layoutParams
        shownId = card.questionId
        enter(root)
        result?.invoke(true)
      } catch (error: RuntimeException) {
        // The permission was taken back, or the window manager refused the view: no card.
        view = null
        params = null
        shownId = null
        result?.invoke(false)
      }
    }
    return true
  }

  /** The card drops in from its top edge with a little bounce, and the blob pops after it. */
  private fun enter(root: View) {
    val box = root.findViewWithTag<View>(TAG_BOX) ?: return
    box.alpha = 0f
    box.translationY = -dp(root.context, 12).toFloat()
    box.animate().alpha(1f).translationY(0f).setDuration(200).start()
  }

  /** Removes the card when it shows `questionId`, or any card when `questionId` is null. */
  fun hide(questionId: String?) {
    main.post {
      if (questionId == null || questionId == shownId) removeView()
    }
  }

  /**
   * The alert a card gesture asked to open and the snooze it chose, if any. Taken from the pending
   * request when it is fresh, else from the activity's launch intent (a cold start). The same
   * request can reach JavaScript again by the new-intent event; its `nonce` lets JavaScript skip it.
   */
  fun takeOpened(activityIntent: Intent?): Opened? {
    val pending = pendingOpen
    if (pending != null) {
      pendingOpen = null
      if (SystemClock.elapsedRealtime() - pendingAt < PENDING_OPEN_MS) return pending
    }
    val id = activityIntent?.getStringExtra(EXTRA_QUESTION_ID) ?: return null
    val snooze = activityIntent.getBooleanExtra(EXTRA_SNOOZE, false)
    val minutes = activityIntent.getIntExtra(EXTRA_SNOOZE_MINUTES, SNOOZE_CHOICES)
    val nonce = activityIntent.getLongExtra(EXTRA_NONCE, 0L)
    activityIntent.removeExtra(EXTRA_QUESTION_ID)
    activityIntent.removeExtra(EXTRA_SNOOZE)
    activityIntent.removeExtra(EXTRA_SNOOZE_MINUTES)
    activityIntent.removeExtra(EXTRA_NONCE)
    return Opened(id, snooze, minutes, nonce)
  }

  /** Replies typed on the card that JavaScript has not sent yet, oldest first. */
  fun pendingReplies(context: Context): List<CardReply> {
    val array = readReplies(context)
    return (0 until array.length()).map { index ->
      val item = array.getJSONObject(index)
      CardReply(item.getString("questionId"), item.getString("text"), item.getLong("nonce"))
    }
  }

  /** Forgets one reply once JavaScript has taken it (sent, or put in its own queue). */
  fun clearReply(context: Context, nonce: Long) {
    val array = readReplies(context)
    val kept = JSONArray()
    for (index in 0 until array.length()) {
      val item = array.getJSONObject(index)
      if (item.getLong("nonce") != nonce) kept.put(item)
    }
    prefs(context).edit().putString(REPLIES_KEY, kept.toString()).apply()
  }

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun readReplies(context: Context): JSONArray =
    try {
      JSONArray(prefs(context).getString(REPLIES_KEY, "[]") ?: "[]")
    } catch (error: org.json.JSONException) {
      JSONArray()
    }

  private fun storeReply(context: Context, reply: CardReply) {
    val array = readReplies(context)
    array.put(JSONObject().put("questionId", reply.questionId).put("text", reply.text).put("nonce", reply.nonce))
    prefs(context).edit().putString(REPLIES_KEY, array.toString()).apply()
  }

  /**
   * Cancels the ring notifications for one alert. Notifee posts them with the alert id as the tag,
   * so the id and tag are matched from the active notifications rather than rebuilt.
   */
  fun silenceNotifications(context: Context, questionId: String) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.activeNotifications
      .filter { it.tag == questionId }
      .forEach { manager.cancel(it.tag, it.id) }
  }

  /** Opens Puck on the alert. `snoozeMinutes` is meaningful only with `snooze`: see [SNOOZE_CHOICES]. */
  fun openApp(context: Context, questionId: String, snooze: Boolean, snoozeMinutes: Int = SNOOZE_CHOICES) {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    openingId = questionId
    openingReady = false
    var fresh: View? = null
    if (cover == null) {
      val sheet = FrameLayout(context).apply {
        val night = context.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK == android.content.res.Configuration.UI_MODE_NIGHT_YES
        setBackgroundColor(if (night) 0xFF141312.toInt() else 0xFFFFFFFF.toInt())
        // Comes in softly rather than flashing white over the app in use.
        if (motionEnabled()) alpha = 0f
      }
      guardCover(sheet) { false }
      try {
        windowManager(context).addView(sheet, fullScreenParams())
        cover = sheet
        fresh = sheet
        sheet.animate().alpha(1f).setDuration(180L).setInterpolator(DecelerateInterpolator()).start()
      } catch (_: RuntimeException) { }
    }
    val openingCover = cover
    main.postDelayed({ if (openingId == questionId && cover === openingCover) openingCover?.let { removeCover(it) } }, 10_000L)
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    launch.putExtra(EXTRA_QUESTION_ID, questionId)
    launch.putExtra(EXTRA_SNOOZE, snooze)
    launch.putExtra(EXTRA_SNOOZE_MINUTES, snoozeMinutes)
    val nonce = nonces.incrementAndGet()
    launch.putExtra(EXTRA_NONCE, nonce)
    pendingOpen = Opened(questionId, snooze, snoozeMinutes, nonce)
    pendingAt = SystemClock.elapsedRealtime()
    // A cover added in the same moment Puck launches stays hidden until Android's app-opening
    // transition ends (see Expander.complete), so a new cover gets two frames on screen first.
    val shown = fresh
    if (shown == null) {
      context.startActivity(launch)
    } else {
      shown.postOnAnimation { shown.postOnAnimation { context.startActivity(launch) } }
    }
  }

  /**
   * Brings Puck to the front on an alert over the app in use: the person chose full screen while
   * the phone is in use. The same opening as a tap on the card, without the card: a cover fades in
   * and fades onto the alert once it is ready. Android lets Puck start its screen from the
   * background because it may draw over other apps. False without that permission.
   */
  fun openFullScreen(context: Context, questionId: String): Boolean {
    if (!canDraw(context)) return false
    val app = context.applicationContext
    main.post {
      if (Presence.inFront) return@post
      removeView()
      try {
        openApp(app, questionId, snooze = false)
      } catch (error: RuntimeException) {
        // Refused: the notification still rings and opens the alert.
      }
    }
    return true
  }

  private fun overlayType(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }

  private fun windowManager(context: Context): WindowManager =
    context.getSystemService(Context.WINDOW_SERVICE) as WindowManager

  private fun removeView() {
    val current = view ?: return
    view = null
    params = null
    shownId = null
    try {
      windowManager(current.context).removeView(current)
    } catch (error: RuntimeException) {
      // Already gone.
    }
  }

  /** Removes the card, stops this alert's ring, and reports the action to JavaScript. */
  private fun release(context: Context, questionId: String, action: String) {
    removeView()
    silenceNotifications(context, questionId)
    onAction?.invoke(questionId, action, null, 0L)
  }

  /**
   * Removes the card, stops the ring, and keeps the reply on the phone until JavaScript takes it.
   * The reply is stored first, so it survives Puck being closed; the event then lets a running app
   * send it at once.
   */
  private fun submitReply(context: Context, card: Spec, text: String) {
    removeView()
    silenceNotifications(context, card.questionId)
    val reply = CardReply(card.questionId, text, nonces.incrementAndGet())
    storeReply(context, reply)
    onAction?.invoke(card.questionId, ACTION_REPLY, text, reply.nonce)
  }

  private const val TAG_BOX = "puck-card-box"
  private const val TAG_BLOB = "puck-card-blob"

  /** The pieces of the sideways snooze reveal that change while the card is dragged. */
  private class Reveal(
    val layout: LinearLayout,
    val emoji: TextView,
    val big: TextView,
    val small: TextView,
  )

  /** The reply area under the card: a text field, Send, and a cancel. */
  private class ReplyArea(
    val layout: LinearLayout,
    val input: EditText,
    val send: TextView,
    val cancel: TextView,
  )

  private class Parts(
    val root: FrameLayout,
    val box: View,
    val reveal: Reveal,
    val reply: ReplyArea,
    val card: Spec,
  )

  private fun buildView(context: Context, card: Spec): View {
    val corner = dp(context, CORNER_DP).toFloat()
    val box = LinearLayout(context).apply {
      tag = TAG_BOX
      orientation = LinearLayout.VERTICAL
      setPadding(dp(context, 16), dp(context, 14), dp(context, 16), dp(context, 12))
      // A wash of the bot's colour that fades to the card colour, like the cards in the app.
      // The edge parts the card from a busy wallpaper; the shadow lifts it off a plain one.
      background = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        intArrayOf(ColorUtils.blendARGB(card.background, card.botColour, 0.07f), card.background),
      ).apply {
        cornerRadius = corner
        setStroke(max(1, dpF(context, EDGE_DP).toInt()), edgeColour(card))
      }
      elevation = dp(context, ELEVATION_DP).toFloat()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        outlineAmbientShadowColor = 0x40000000
        outlineSpotShadowColor = 0x73000000
      }
      // A tap opens Puck the way a pull does: the card grows into the screen, without the pull.
      setOnClickListener { view ->
        Expander(context, view, card, travel = 1f, follow = false).apply { begin(); complete() }
      }
    }

    val blob = BlobView(context, card).apply { tag = TAG_BLOB }
    val texts = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      // As NeedCard in the app: the question in Nunito ExtraBold, the bot's name under it.
      addView(line(context, card.body, card.ink, 16.5f, font(context, Nunito.EXTRA_BOLD), maxLines = 3, lineHeightSp = 20.6f))
      addView(line(context, card.title, card.ink2, 13f, font(context, Nunito.BOLD), maxLines = 1, topPaddingDp = 3))
    }
    val top = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      addView(blob, LinearLayout.LayoutParams(dp(context, 42), dp(context, 42)).apply { marginEnd = dp(context, 14) })
      addView(texts, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
    }
    box.addView(top)

    // Under the card when it is dragged left: the bot's colour and what a snooze would pick.
    val emoji = TextView(context).apply {
      text = "💤"
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 30f)
    }
    val big = TextView(context).apply {
      setTextColor(card.onBot)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 36f)
      typeface = font(context, Nunito.BLACK)
      setPadding(dp(context, 12), 0, dp(context, 6), 0)
    }
    val small = TextView(context).apply {
      setTextColor(card.onBot)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
      typeface = font(context, Nunito.EXTRA_BOLD)
    }
    val reveal = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL or Gravity.END
      setPadding(dp(context, 26), 0, dp(context, 26), 0)
      // One flat colour: the bot's, with no gradient.
      background = GradientDrawable().apply {
        setColor(card.botColour)
        cornerRadius = corner
      }
      visibility = View.INVISIBLE
      addView(emoji)
      addView(big)
      addView(small)
    }
    val snoozeReveal = Reveal(reveal, emoji, big, small)

    // Under the card when it is dragged right: the reply text field, Send and a cancel.
    val input = EditText(context).apply {
      setTextColor(card.ink)
      setHintTextColor(card.ink2)
      hint = "Reply to ${card.title}"
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
      typeface = font(context, Nunito.BOLD)
      isSingleLine = true
      inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
      imeOptions = EditorInfo.IME_ACTION_SEND
      background = null
      setPadding(0, dp(context, 6), dp(context, 8), dp(context, 6))
    }
    val send = TextView(context).apply {
      text = "Send"
      setTextColor(card.accent)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
      typeface = font(context, Nunito.EXTRA_BOLD)
      setPadding(dp(context, 12), dp(context, 8), dp(context, 12), dp(context, 8))
      isClickable = true
    }
    val cancel = TextView(context).apply {
      text = "✕"
      setTextColor(card.ink2)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
      typeface = font(context, Nunito.EXTRA_BOLD)
      setPadding(dp(context, 10), dp(context, 8), dp(context, 4), dp(context, 8))
      isClickable = true
    }
    val replyLayout = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(context, 16), dp(context, 14), dp(context, 12), dp(context, 12))
      background = GradientDrawable().apply {
        setColor(card.background)
        cornerRadius = corner
        setStroke(dp(context, 1), card.botColour)
      }
      visibility = View.INVISIBLE
      addView(input, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
      addView(send)
      addView(cancel)
    }
    val replyArea = ReplyArea(replyLayout, input, send, cancel)

    val side = dp(context, SHADOW_DP)
    val root = FrameLayout(context).apply {
      setPadding(side, dp(context, SHADOW_DP), side, dp(context, SHADOW_DP))
      // The padding is the shadow's room. A ViewGroup clips its children to inside its padding by
      // default, which cut the shadow off at the card's bounds and left only the bits in the rounded
      // corners showing.
      clipToPadding = false
      clipChildren = false
      addView(snoozeReveal.layout, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
      addView(replyLayout, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
      addView(box, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
    }
    val parts = Parts(root, box, snoozeReveal, replyArea, card)
    send.setOnClickListener { sendReply(context, parts) }
    input.setOnEditorActionListener { _, actionId, _ ->
      if (actionId == EditorInfo.IME_ACTION_SEND) {
        sendReply(context, parts)
        true
      } else {
        false
      }
    }
    cancel.setOnClickListener { cancelReply(parts) }
    attachGestures(context, parts)
    return root
  }

  /** Sets the snooze reveal's text for a length. It always sits on the right, where a left swipe leaves it. */
  private fun setReveal(reveal: Reveal, minutes: Int, bump: Boolean) {
    when (minutes) {
      5, 10 -> {
        reveal.big.text = minutes.toString()
        reveal.small.text = "minutes"
      }
      SNOOZE_UNTIL_BACK -> {
        reveal.big.text = "∞"
        reveal.small.text = "until I'm back"
      }
      else -> {
        reveal.big.text = ""
        reveal.small.text = "keep going"
      }
    }

  }

  private enum class Axis { NONE, HORIZONTAL, VERTICAL }

  /**
   * One finger on the card. The first move past the touch slop picks the axis: sideways reveals a
   * snooze (left) or the reply area (right); vertical hides (up) or opens (down). Positions use raw
   * screen coordinates, so changes to the card's own window while a drag runs do not disturb them.
   * The pull-down is drawn by a separate full-screen window, so it is never cut off by the card's
   * window; the card window stays under the finger to keep receiving the touch.
   */
  private fun attachGestures(context: Context, parts: Parts) {
    val box = parts.box
    val card = parts.card
    val slop = ViewConfiguration.get(context).scaledTouchSlop
    var downX = 0f
    var downY = 0f
    var axis = Axis.NONE
    var minutes = 0
    var tracker: VelocityTracker? = null
    var expander: Expander? = null

    fun finish() {
      tracker?.recycle()
      tracker = null
      axis = Axis.NONE
      minutes = 0
    }

    fun settleBack() {
      box.animate().translationX(0f).translationY(0f).alpha(1f).setDuration(SETTLE_MS)
        .withEndAction { hideUnderneath(parts); setRoom(parts.root, false) }
        .start()
    }

    box.setOnTouchListener { _, event ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downX = event.rawX
          downY = event.rawY
          axis = Axis.NONE
          minutes = 0
          expander = null
          box.animate().cancel()
          // Whatever a gesture uncovered under the card belongs to that gesture only. Left showing,
          // the reply area waited behind the opaque card and came into view as soon as a pull-down
          // made the card see-through.
          hideUnderneath(parts)
          tracker?.recycle()
          tracker = VelocityTracker.obtain().also { it.addMovement(event) }
          true
        }
        MotionEvent.ACTION_MOVE -> {
          tracker?.addMovement(event)
          val dx = event.rawX - downX
          val dy = event.rawY - downY
          if (axis == Axis.NONE && (abs(dx) > slop || abs(dy) > slop)) {
            axis = if (abs(dy) > abs(dx)) Axis.VERTICAL else Axis.HORIZONTAL
            if (axis == Axis.VERTICAL) {
              if (dy > 0) {
                // The way to the bottom of the screen is the whole pull: 100% is the finger at the bottom.
                val travel = max(1f, screenSize(context).second - downY)
                expander = Expander(context, box, card, travel).also { it.begin() }
              } else {
                // Room above, so an upward drag is not cut off at the card's own top edge.
                setRoom(parts.root, true)
              }
            } else {
              setReveal(parts.reveal, 0, bump = false)
            }
          }
          if (axis == Axis.HORIZONTAL) {
            // Under the card, only what this side of the drag opens: the snooze colours to the left,
            // the reply area to the right, even when the finger crosses back over the start.
            parts.reveal.layout.visibility = if (dx < 0) View.VISIBLE else View.INVISIBLE
            parts.reply.layout.visibility = if (dx < 0) View.INVISIBLE else View.VISIBLE
          }
          when (axis) {
            Axis.HORIZONTAL -> if (dx < 0) {
              box.translationX = dx
              box.alpha = 1f - 0.25f * min(abs(dx) / box.width, 1f)
              val next = snoozeMinutesFor(abs(dx) / box.width)
              if (next != minutes) {
                minutes = next
                box.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                setReveal(parts.reveal, minutes, bump = true)
              }
            } else {
              // To the right the reply area waits underneath; the card just moves aside.
              box.translationX = dx
            }
            Axis.VERTICAL -> {
              val grow = expander
              if (grow != null) {
                grow.update(dy)
              } else if (dy < 0) {
                box.translationY = dy
                box.alpha = 1f - min(abs(dy) / (box.height * 1.4f), 0.85f)
              } else {
                box.translationY = min(dy * 0.5f, dp(context, 90).toFloat())
                box.alpha = 1f
              }
            }
            Axis.NONE -> Unit
          }
          true
        }
        MotionEvent.ACTION_UP -> {
          tracker?.addMovement(event)
          tracker?.computeCurrentVelocity(1000)
          val vy = tracker?.yVelocity ?: 0f
          val dx = event.rawX - downX
          val dy = event.rawY - downY
          val grow = expander
          when (axis) {
            Axis.NONE -> box.performClick()
            Axis.HORIZONTAL -> if (dx < 0) {
              val picked = snoozeMinutesFor(abs(dx) / box.width)
              if (picked == 0) {
                settleBack()
              } else {
                box.animate()
                  .translationX(sign(dx) * box.width)
                  .alpha(0f)
                  .setDuration(SETTLE_MS)
                  .withEndAction {
                    release(context, card.questionId, ACTION_SNOOZE)
                    openApp(context, card.questionId, snooze = true, snoozeMinutes = picked)
                  }
                  .start()
              }
            } else if (dx > box.width * REPLY_FRACTION) {
              startReply(parts)
            } else {
              settleBack()
            }
            Axis.VERTICAL -> when {
              grow != null ->
                if (grow.progress >= COMMIT_FRACTION || vy > FLING_DOWN) grow.complete() else grow.cancel()
              dy < 0 && (-dy > box.height * 0.4f || vy < FLING_UP) -> {
                box.animate()
                  .translationY(-(box.height + dp(context, TOP_MARGIN_DP)).toFloat())
                  .alpha(0f)
                  .setDuration(SETTLE_MS)
                  .withEndAction { release(context, card.questionId, ACTION_DISMISS) }
                  .start()
              }
              else -> settleBack()
            }
          }
          expander = null
          finish()
          true
        }
        MotionEvent.ACTION_CANCEL -> {
          val grow = expander
          if (grow != null) grow.cancel() else if (axis != Axis.NONE) settleBack()
          expander = null
          finish()
          true
        }
        else -> false
      }
    }
  }

  /** Hides what sits under the card (the snooze colours and the reply area) until a gesture uncovers it. */
  private fun hideUnderneath(parts: Parts) {
    parts.reveal.layout.visibility = View.INVISIBLE
    parts.reply.layout.visibility = View.INVISIBLE
  }

  /**
   * A full-screen window that draws over the whole display, status bar strip included. It takes
   * touches on purpose: since Android 12 an overlay that lets touches through (FLAG_NOT_TOUCHABLE)
   * is drawn at no more than 80% opacity (the "maximum obscuring opacity"), which made the white
   * sheet see-through, with Puck loading visibly behind it. [guardCover] makes sure such a window
   * can never trap the screen. Since Android 11 a window is fitted inside the system bars unless it says otherwise
   * (FLAG_LAYOUT_IN_SCREEN no longer does), so without `fitInsetsTypes = 0` the window starts below
   * the status bar and anything placed in it by screen position lands that much lower.
   */
  private fun fullScreenParams(): WindowManager.LayoutParams =
    WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      overlayType(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        fitInsetsTypes = 0
        layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
      } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
      }
    }

  /**
   * The card steps aside to reveal the reply area: the card fades, the text field takes the card's
   * place, the window takes focus and the keyboard opens.
   */
  private fun startReply(parts: Parts) {
    val box = parts.box
    box.animate().cancel()
    box.animate().alpha(0f).translationX(0f).setDuration(SETTLE_MS)
      .withEndAction { box.visibility = View.INVISIBLE; parts.reveal.layout.visibility = View.INVISIBLE }
      .start()
    parts.reply.layout.visibility = View.VISIBLE
    setFocusable(parts.root, true)
    parts.reply.input.requestFocus()
    parts.reply.input.post { showKeyboard(parts.reply.input) }
  }

  /** Sends the typed reply, unless the field is empty. */
  private fun sendReply(context: Context, parts: Parts) {
    val text = parts.reply.input.text.toString().trim()
    if (text.isEmpty()) return
    hideKeyboard(parts.reply.input)
    setFocusable(parts.root, false)
    submitReply(context, parts.card, text)
  }

  /** Cancels the reply: the keyboard goes, and the card comes back. */
  private fun cancelReply(parts: Parts) {
    hideKeyboard(parts.reply.input)
    parts.reply.input.setText("")
    parts.reply.layout.visibility = View.INVISIBLE
    setFocusable(parts.root, false)
    val box = parts.box
    box.animate().cancel()
    box.visibility = View.VISIBLE
    box.animate().alpha(1f).translationX(0f).setDuration(SETTLE_MS).start()
  }

  /** Takes focus for the reply's keyboard, or gives it back so the app underneath keeps every touch. */
  private fun setFocusable(root: FrameLayout, focusable: Boolean) {
    val current = params ?: return
    if (view !== root) return
    current.flags = if (focusable) {
      current.flags and WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE.inv()
    } else {
      current.flags or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
    }
    current.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE or
      WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING
    try {
      windowManager(root.context).updateViewLayout(root, current)
    } catch (error: RuntimeException) {
      // The window is gone.
    }
  }

  private fun showKeyboard(input: View) {
    try {
      val manager = input.context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
      manager.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
    } catch (error: RuntimeException) {
      // No input method: the reply can still be cancelled.
    }
  }

  private fun hideKeyboard(input: View) {
    try {
      val manager = input.context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
      manager.hideSoftInputFromWindow(input.windowToken, 0)
    } catch (error: RuntimeException) {
      // Already hidden.
    }
  }

  /**
   * Gives an upward drag space: the window starts at the top of the screen, with the card's usual
   * top margin as padding. Touches in that gap belong to the card window only while a drag lasts;
   * `on = false` puts the window back to the card's own position.
   */
  private fun setRoom(root: FrameLayout, on: Boolean) {
    val current = params ?: return
    if (view !== root) return
    val context = root.context
    val side = dp(context, SHADOW_DP)
    if (on) {
      current.y = 0
      root.setPadding(side, dp(context, TOP_MARGIN_DP), side, dp(context, ROOM_BELOW_DP))
    } else {
      current.y = dp(context, TOP_MARGIN_DP - SHADOW_DP)
      root.setPadding(side, dp(context, SHADOW_DP), side, dp(context, SHADOW_DP))
    }
    try {
      windowManager(context).updateViewLayout(root, current)
    } catch (error: RuntimeException) {
      // The window is gone.
    }
  }

  private fun screenSize(context: Context): Pair<Int, Int> {
    val wm = windowManager(context)
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val bounds = wm.currentWindowMetrics.bounds
      Pair(bounds.width(), bounds.height())
    } else {
      val metrics = android.util.DisplayMetrics()
      @Suppress("DEPRECATION")
      wm.defaultDisplay.getRealMetrics(metrics)
      Pair(metrics.widthPixels, metrics.heightPixels)
    }
  }

  /**
   * The pull-down transition, drawn in its own full-screen window so nothing clips it. A sheet that
   * starts as an exact copy of the card (a picture of it, edge and shadow included) follows the
   * finger down and grows into the full screen: at a pull of `dy` the copy has moved down by `dy` and
   * is `dy / travel` of the way to the whole screen, so the finger stays on it the whole way and it
   * fills the screen as the finger reaches the bottom. Its colour turns to the app's background by
   * [COLOUR_DONE] and the picture is gone by then. [complete] finishes the growth, starts Puck
   * beneath, holds a moment and fades the sheet away so the alert appears to come in through it.
   * [cancel] eases it back onto the card. The bot's blob is not part of the picture: it is a live
   * copy above the sheet, so it stays whole while the rest of the card fades, and when the sheet
   * finishes it flies to where the alert screen draws the blob (see [alertBlobTarget]), so the
   * sheet fades away onto the same blob. A tap runs the same growth with `follow` off: the copy
   * grows from where the card is instead of moving down first.
   *
   * Positions: the card's place comes from `getLocationOnScreen`, in screen pixels. The sheet's own
   * window is measured the same way once it is laid out, and everything is placed relative to it,
   * so the copy sits exactly on the card even if Android puts the window somewhere other than the
   * top left of the screen. Until then the real card stays visible and the copy hidden.
   */
  private class Expander(
    private val context: Context,
    private val box: View,
    private val card: Spec,
    val travel: Float,
    private val follow: Boolean = true,
  ) {
    private val width = box.width
    private val height = box.height
    private val at = IntArray(2)
    private val origin = IntArray(2)
    private val radiusFrom = dp(context, CORNER_DP).toFloat()
    private val radiusTo = screenCornerRadius(context)
    private val elevationFrom = dp(context, ELEVATION_DP).toFloat()
    private val edgeWidth = max(1, dpF(context, EDGE_DP).toInt())
    private val edge = edgeColour(card)
    // The card's own surface, wash and all: the picture holds only the card's content, so the sheet
    // is the one surface with the one edge, and nothing inside it draws a second border.
    private val wash = ColorUtils.blendARGB(card.background, card.botColour, 0.07f)
    private val fillBackground = GradientDrawable(
      GradientDrawable.Orientation.LEFT_RIGHT,
      intArrayOf(wash, card.background),
    ).apply { cornerRadius = radiusFrom }
    private val blob: View? = box.findViewWithTag(TAG_BLOB)
    private val blobAt = IntArray(2)
    private val blobFrom = blob?.width ?: 0
    private val target = alertBlobTarget(context)
    private val flyer = BlobView(context, card)
    /** 0 while the blob rides on the card, 1 once it is on the alert's blob. */
    private var flight = 0f
    private var flightAnimator: ValueAnimator? = null
    private val picture = ImageView(context)
    private val fill = FrameLayout(context)
    private val sheet = FrameLayout(context)
    private val colours = ArgbEvaluator()
    private var ready = false
    private var placed = false
    private var done = false
    private var animator: ValueAnimator? = null
    private var growing = false
    /** Runs once the copy is placed: a completion asked for before the sheet was laid out. */
    private var whenPlaced: (() -> Unit)? = null
    /** How far the finger has pulled down from where it pressed, in pixels. */
    private var pull = 0f
    var progress = 0f
      private set

    fun begin() {
      if (width <= 0 || height <= 0) return
      // The picture is the card's content alone: no background (the sheet draws it, with the edge)
      // and no blob (the flyer is the blob).
      val snapshot = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(snapshot)
      blob?.visibility = View.INVISIBLE
      if (box is android.view.ViewGroup) {
        for (index in 0 until box.childCount) {
          val child = box.getChildAt(index)
          canvas.save()
          canvas.translate(child.left.toFloat(), child.top.toFloat())
          child.draw(canvas)
          canvas.restore()
        }
      }
      blob?.visibility = View.VISIBLE
      box.getLocationOnScreen(at)
      blob?.getLocationOnScreen(blobAt)
      picture.setImageBitmap(snapshot)
      fill.background = fillBackground
      fill.elevation = elevationFrom
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        fill.outlineAmbientShadowColor = box.outlineAmbientShadowColor
        fill.outlineSpotShadowColor = box.outlineSpotShadowColor
      }
      fill.visibility = View.INVISIBLE
      fill.addView(picture, FrameLayout.LayoutParams(width, height, Gravity.TOP or Gravity.START))
      sheet.addView(fill, FrameLayout.LayoutParams(width, height))
      if (blob != null && blobFrom > 0) {
        // Drawn at the alert's size and scaled down to the card's, so it is sharp when it lands.
        // Above the sheet's shadow, which would otherwise draw over it.
        flyer.pivotX = 0f
        flyer.pivotY = 0f
        flyer.translationZ = elevationFrom + 1f
        flyer.visibility = View.INVISIBLE
        sheet.addView(flyer, FrameLayout.LayoutParams(target.width().toInt(), target.height().toInt()))
      }
      sheet.addOnLayoutChangeListener { view, _, _, _, _, _, _, _, _ -> placeSheet(view) }
      guardCover(sheet) { animator?.isRunning == true }
      try {
        windowManager(context).addView(sheet, fullScreenParams())
      } catch (error: RuntimeException) {
        return
      }
      cover?.let { if (it !== sheet) removeCover(it) }
      cover = sheet
      ready = true
    }

    /**
     * The sheet's window has been laid out: measure where it really is, put the copy exactly over the
     * card, show it, and only then hide the real card (after this frame is drawn), so nothing blinks.
     */
    private fun placeSheet(view: View) {
      val x = origin[0]
      val y = origin[1]
      view.getLocationOnScreen(origin)
      if (placed && x == origin[0] && y == origin[1]) return
      if (!placed) Log.d("PuckCard", "pull-down sheet at ${origin[0]},${origin[1]}; card at ${at[0]},${at[1]}")
      placed = true
      apply()
      if (fill.visibility != View.VISIBLE) {
        fill.visibility = View.VISIBLE
        if (flyer.parent != null) flyer.visibility = View.VISIBLE
        sheet.post {
          if (!done || growing) {
            box.alpha = 0f
            box.translationY = 0f
          }
        }
        whenPlaced?.let { whenPlaced = null; sheet.post(it) }
      }
    }

    /** Follows the finger: `dy` is how far it has moved down since it pressed. */
    fun update(dy: Float) {
      if (!ready) return
      pull = dy.coerceIn(0f, travel)
      progress = pull / travel
      // Until the copy is placed, the card itself follows the finger, so the very first frames of
      // the pull already move.
      if (placed) apply() else box.translationY = pull
    }

    private fun apply() {
      val t = progress
      // The card's rectangle moved down by the pull, and the sheet's own (the whole screen), in the
      // sheet's coordinates; the copy is t of the way from the first to the second.
      val cardLeft = (at[0] - origin[0]).toFloat()
      val cardTop = (at[1] - origin[1]) + if (follow) pull else 0f
      val screenW = if (sheet.width > 0) sheet.width else screenSize(context).first
      val screenH = if (sheet.height > 0) sheet.height else screenSize(context).second
      val left = lerpF(cardLeft, 0f, t)
      val top = lerpF(cardTop, 0f, t)
      val right = lerpF(cardLeft + width, screenW.toFloat(), t)
      val bottom = lerpF(cardTop + height, screenH.toFloat(), t)
      val lp = fill.layoutParams as FrameLayout.LayoutParams
      lp.leftMargin = left.toInt()
      lp.topMargin = top.toInt()
      lp.width = (right - left).toInt()
      lp.height = (bottom - top).toInt()
      fill.layoutParams = lp
      val colour = min(1f, t / COLOUR_DONE)
      // The sheet keeps its edge and shadow while it grows, so it reads as one card getting bigger;
      // both go only over the last stretch, as it meets the screen's edges and corners.
      val landing = ((t - 0.85f) / 0.15f).coerceIn(0f, 1f)
      fillBackground.cornerRadius = lerpF(radiusFrom, radiusTo, t)
      fillBackground.colors = intArrayOf(
        colours.evaluate(colour, wash, card.screen) as Int,
        colours.evaluate(colour, card.background, card.screen) as Int,
      )
      fillBackground.setStroke(edgeWidth, ColorUtils.setAlphaComponent(edge, (android.graphics.Color.alpha(edge) * (1f - landing)).toInt()))
      fill.elevation = elevationFrom * (1f - landing)
      picture.alpha = 1f - colour
      placeFlyer(left, top)
    }

    /** The blob: on the card's copy (whose top left is `left`, `top`), `flight` of the way to the alert's. */
    private fun placeFlyer(left: Float, top: Float) {
      if (flyer.parent == null || target.width() <= 0f) return
      val fromX = left + (blobAt[0] - at[0])
      val fromY = top + (blobAt[1] - at[1])
      val toX = target.left - origin[0]
      val toY = target.top - origin[1]
      val f = flight
      flyer.translationX = lerpF(fromX, toX, f)
      flyer.translationY = lerpF(fromY, toY, f)
      val scale = lerpF(blobFrom / target.width(), 1f, f)
      flyer.scaleX = scale
      flyer.scaleY = scale
    }

    /** Flies the blob onto the alert's, on the same spring as the sheet. */
    private fun fly() {
      if (flyer.parent == null) return
      blobFlownAt = SystemClock.elapsedRealtime()
      flightAnimator?.cancel()
      val seconds = 0.42f * 1.4f
      flightAnimator = ValueAnimator.ofFloat(flight, 1f).apply {
        duration = if (motionEnabled()) (seconds * 1000f).toLong() else 0L
        interpolator = Spring(0.42f, 0.86f, seconds)
        addUpdateListener {
          flight = it.animatedValue as Float
          if (placed) apply()
        }
        start()
      }
    }

    /** Springs the pull to `target`: [Spring] with this response and damping. */
    private fun springTo(target: Float, response: Float, damping: Float, onEnd: () -> Unit) {
      animator?.cancel()
      val seconds = response * 1.4f
      animator = ValueAnimator.ofFloat(pull, target).apply {
        duration = if (motionEnabled()) (seconds * 1000f).toLong() else 0L
        interpolator = Spring(response, damping, seconds)
        addUpdateListener { update(it.animatedValue as Float) }
        addListener(object : android.animation.AnimatorListenerAdapter() {
          override fun onAnimationEnd(animation: android.animation.Animator) {
            update(target)
            onEnd()
          }
        })
        start()
      }
    }

    /** Let go past the mark: finish growing, open Puck beneath, hold, fade the sheet away. */
    fun complete() {
      done = true
      if (!ready) {
        openApp(context, card.questionId, snooze = false)
        removeView()
        return
      }
      openingAnimating = true
      growing = true
      main.postDelayed({ removeCover(sheet) }, COVER_SAFETY_MS)
      val grow = {
        // The copy is on screen now, so the card's own window can go.
        sheet.post { removeView() }
        // Puck starts only once the sheet has been drawn and shown (two frames on). Launched in the
        // same moment the sheet window was added (a tap), Android's app-opening transition held the
        // new window back until it ended, and the whole growth played unseen.
        sheet.postOnAnimation {
          sheet.postOnAnimation { openApp(context, card.questionId, snooze = false) }
        }
        fly()
        springTo(travel, response = 0.42f, damping = 0.86f) {
          openingAnimating = false
          if (openingReady) fadeOutCover(sheet)
        }
      }
      if (placed) grow() else whenPlaced = grow
    }

    /**
     * Let go early: ease back onto the card, show the card again, and take the copy away a frame
     * later, so for one frame both are up (they look the same) rather than neither.
     */
    fun cancel() {
      done = true
      if (!ready || !placed) {
        box.animate().translationY(0f).alpha(1f).setDuration(SETTLE_MS).start()
        if (ready) removeCover(sheet)
        return
      }
      springTo(0f, response = 0.34f, damping = 0.9f) {
        box.alpha = 1f
        sheet.post { removeCover(sheet) }
      }
    }
  }

  /**
   * A full-screen sheet swallows touches while it animates (a finger already on the card keeps
   * going to the card). Once it is only waiting for Puck, a touch takes it away at once, so it can
   * never leave the phone stuck behind a blank screen.
   */
  private fun guardCover(sheet: View, animating: () -> Boolean) {
    sheet.setOnTouchListener { _, event ->
      if (event.actionMasked == MotionEvent.ACTION_DOWN && !animating()) removeCover(sheet)
      true
    }
  }

  /** A sheet's corners at full size: the screen's own rounded corners, where Android reports them. */
  private fun screenCornerRadius(context: Context): Float {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val corner = windowManager(context).currentWindowMetrics.windowInsets
        .getRoundedCorner(android.view.RoundedCorner.POSITION_TOP_LEFT)
      if (corner != null) return corner.radius.toFloat()
    }
    return 0f
  }

  /**
   * A damped spring as an interpolator, the way iOS moves a notification into its app: quick off
   * the mark, then settling without a bounce you can see. `response` is the spring's period in
   * seconds, `damping` its damping ratio (1 is no overshoot); the animation should last about
   * 1.4 x `response` so it has settled by the end.
   */
  private class Spring(private val response: Float, private val damping: Float, private val seconds: Float) :
    android.animation.TimeInterpolator {
    private val omega = (2.0 * Math.PI / response).toFloat()
    private val decay = damping * omega
    private val omegaD = omega * kotlin.math.sqrt(1f - damping * damping)

    override fun getInterpolation(input: Float): Float {
      if (input >= 1f) return 1f
      val t = input * seconds
      return 1f - kotlin.math.exp(-decay * t) * (kotlin.math.cos(omegaD * t) + decay / omegaD * kotlin.math.sin(omegaD * t))
    }
  }

  private fun fadeOutCover(sheet: View) {
    if (cover !== sheet) return
    sheet.animate().alpha(0f).setDuration(if (motionEnabled()) 200L else 0L)
      .setInterpolator(DecelerateInterpolator())
      .withEndAction { removeCover(sheet) }.start()
  }

  private fun removeCover(sheet: View) {
    if (cover === sheet) cover = null
    try {
      windowManager(sheet.context).removeView(sheet)
    } catch (error: RuntimeException) {
      // Already gone.
    }
  }

  private fun lerpF(from: Float, to: Float, t: Float): Float = from + (to - from) * t

  /**
   * The bot's blob, the same body and eyes as the app's: the body path in a 100 x 100 box, tilted,
   * with two white eyes that glance about and blink now and then.
   */
  private class BlobView(context: Context, private val card: Spec) : View(context) {
    private val body: Path = try {
      PathParser.createPathFromPathData(card.blobPath) ?: Path().apply { addCircle(50f, 50f, 43f, Path.Direction.CW) }
    } catch (error: RuntimeException) {
      Path().apply { addCircle(50f, 50f, 43f, Path.Direction.CW) }
    }
    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = card.blobFill; style = Paint.Style.FILL }
    private val rimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = card.blobRim ?: 0
      style = Paint.Style.STROKE
      strokeWidth = 2f
    }
    private val eyePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFFFFFFF.toInt(); style = Paint.Style.FILL }
    private val eyes = listOf(RectF(56f, 25f, 64.5f, 45f), RectF(70f, 26f, 78.5f, 46f))
    private var eyeX = 0f
    private var eyeY = 0f
    private var eyeScaleY = 1f
    private var glance: ValueAnimator? = null
    private var blink: ValueAnimator? = null

    private val tick = object : Runnable {
      override fun run() {
        val roll = Random.nextFloat()
        if (roll < 0.55f) {
          glanceTo(Random.nextFloat() * 8f - 4f, Random.nextFloat() * 6f - 3f)
        } else if (roll < 0.83f) {
          blinkOnce()
        }
        postDelayed(this, 1700L)
      }
    }

    private fun glanceTo(x: Float, y: Float) {
      glance?.cancel()
      val fromX = eyeX
      val fromY = eyeY
      glance = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 380L
        addUpdateListener {
          val t = it.animatedValue as Float
          eyeX = fromX + (x - fromX) * t
          eyeY = fromY + (y - fromY) * t
          invalidate()
        }
        start()
      }
    }

    private fun blinkOnce() {
      blink?.cancel()
      blink = ValueAnimator.ofFloat(1f, 0.12f, 1f).apply {
        duration = 220L
        addUpdateListener { eyeScaleY = it.animatedValue as Float; invalidate() }
        start()
      }
    }

    override fun onAttachedToWindow() {
      super.onAttachedToWindow()
      if (motionEnabled()) postDelayed(tick, 900L)
    }

    override fun onDetachedFromWindow() {
      removeCallbacks(tick)
      glance?.cancel()
      blink?.cancel()
      super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
      val unit = min(width, height) / 100f
      canvas.save()
      canvas.scale(unit, unit)
      canvas.save()
      canvas.rotate(card.blobTilt, 50f, 50f)
      canvas.drawPath(body, fillPaint)
      if (card.blobRim != null) canvas.drawPath(body, rimPaint)
      canvas.restore()
      canvas.save()
      canvas.translate(eyeX, eyeY)
      canvas.rotate(-12f, 66f, 36f)
      for (eye in eyes) {
        canvas.save()
        canvas.scale(1f, eyeScaleY, eye.centerX(), eye.centerY())
        canvas.drawRoundRect(eye, 4.25f, 4.25f, eyePaint)
        canvas.restore()
      }
      canvas.restore()
      canvas.restore()
    }
  }

  private fun line(
    context: Context,
    text: String,
    colour: Int,
    sizeSp: Float,
    face: Typeface,
    maxLines: Int = 1,
    topPaddingDp: Int = 0,
    lineHeightSp: Float? = null,
  ): TextView = TextView(context).apply {
    this.text = text
    setTextColor(colour)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
    typeface = face
    includeFontPadding = false
    if (lineHeightSp != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      lineHeight = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, lineHeightSp, context.resources.displayMetrics).toInt()
    }
    this.maxLines = maxLines
    ellipsize = android.text.TextUtils.TruncateAt.END
    setPadding(0, dp(context, topPaddingDp), 0, 0)
  }

  private fun dp(context: Context, value: Int): Int =
    (value * context.resources.displayMetrics.density).toInt()

  private fun dpF(context: Context, value: Float): Float =
    value * context.resources.displayMetrics.density
}
