package puck.fullscreen

import android.animation.ArgbEvaluator
import android.animation.ValueAnimator
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
  // Room around the card for its shadow, so the window never clips it.
  private const val SHADOW_DP = 14
  private const val CORNER_DP = 22

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

  fun canDraw(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)

  fun show(context: Context, card: Spec): Boolean {
    if (!canDraw(context)) return false
    val app = context.applicationContext
    main.post {
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
      } catch (error: RuntimeException) {
        // The permission was taken back, or the window manager refused the view: no card.
        view = null
        params = null
        shownId = null
      }
    }
    return true
  }

  /** The card drops in from its top edge with a little bounce, and the blob pops after it. */
  private fun enter(root: View) {
    val box = root.findViewWithTag<View>(TAG_BOX) ?: return
    val blob = root.findViewWithTag<View>(TAG_BLOB)
    box.alpha = 0f
    box.translationY = -dp(root.context, 28).toFloat()
    box.animate().alpha(1f).translationY(0f).setDuration(380).setInterpolator(OvershootInterpolator(1.0f)).start()
    blob?.let {
      it.scaleX = 0.4f
      it.scaleY = 0.4f
      it.animate().scaleX(1f).scaleY(1f).setStartDelay(140).setDuration(420).setInterpolator(OvershootInterpolator(2.4f)).start()
    }
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
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    launch.putExtra(EXTRA_QUESTION_ID, questionId)
    launch.putExtra(EXTRA_SNOOZE, snooze)
    launch.putExtra(EXTRA_SNOOZE_MINUTES, snoozeMinutes)
    val nonce = nonces.incrementAndGet()
    launch.putExtra(EXTRA_NONCE, nonce)
    pendingOpen = Opened(questionId, snooze, snoozeMinutes, nonce)
    pendingAt = SystemClock.elapsedRealtime()
    context.startActivity(launch)
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
      background = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        intArrayOf(ColorUtils.blendARGB(card.background, card.botColour, 0.2f), card.background),
      ).apply { cornerRadius = corner }
      elevation = dp(context, 8).toFloat()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        // Soft, even shadow all round, not a hard edge under the card.
        outlineAmbientShadowColor = 0x33000000
        outlineSpotShadowColor = 0x4D000000
      }
      setOnClickListener { openApp(context, card.questionId, snooze = false); removeView() }
    }

    val blob = BlobView(context, card).apply { tag = TAG_BLOB }
    val texts = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      addView(line(context, card.label.uppercase(), card.accent, 11f, bold = true))
      addView(line(context, card.title, card.ink, 17f, bold = true, maxLines = 1))
      addView(line(context, card.body, card.ink2, 14f, maxLines = 2, topPaddingDp = 1))
    }
    val top = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      addView(blob, LinearLayout.LayoutParams(dp(context, 56), dp(context, 56)).apply { marginEnd = dp(context, 14) })
      addView(texts, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
    }
    box.addView(top)
    box.addView(line(context, "◀ snooze   ▶ reply   ▲ hide   ▼ open", card.ink2, 11f, topPaddingDp = 8))

    // Under the card when it is dragged left: the bot's colour and what a snooze would pick.
    val emoji = TextView(context).apply {
      text = "💤"
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 30f)
    }
    val big = TextView(context).apply {
      setTextColor(card.onBot)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 36f)
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      setPadding(dp(context, 12), 0, dp(context, 6), 0)
    }
    val small = TextView(context).apply {
      setTextColor(card.onBot)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
      typeface = Typeface.DEFAULT_BOLD
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
      typeface = Typeface.DEFAULT_BOLD
      setPadding(dp(context, 12), dp(context, 8), dp(context, 12), dp(context, 8))
      isClickable = true
    }
    val cancel = TextView(context).apply {
      text = "✕"
      setTextColor(card.ink2)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
      typeface = Typeface.DEFAULT_BOLD
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
    if (bump && minutes != 0) {
      reveal.big.scaleX = 1.4f
      reveal.big.scaleY = 1.4f
      reveal.big.animate().scaleX(1f).scaleY(1f).setDuration(260).setInterpolator(OvershootInterpolator(3f)).start()
      reveal.emoji.rotation = -18f
      reveal.emoji.animate().rotation(0f).setDuration(320).setInterpolator(OvershootInterpolator(3f)).start()
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
        .withEndAction { parts.reveal.layout.visibility = View.INVISIBLE; setRoom(parts.root, false) }
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
            } else if (dx < 0) {
              setReveal(parts.reveal, 0, bump = false)
              parts.reveal.layout.visibility = View.VISIBLE
            } else {
              parts.reply.layout.visibility = View.VISIBLE
            }
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
                grow.update(max(dy, 0f) / grow.travel)
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
   * starts exactly as the card (a picture of it) grows with `progress` (0 to 1, where 1 is the
   * finger at the bottom of the screen) into the full screen. Its colour turns to the app's
   * background by [COLOUR_DONE] and the picture is gone by then; the shape and centre move the
   * whole way. [complete] finishes the growth, starts Puck beneath, holds a moment and fades the
   * sheet away so the alert appears to come in through it. [cancel] shrinks it back onto the card.
   */
  private class Expander(
    private val context: Context,
    private val box: View,
    private val card: Spec,
    val travel: Float,
  ) {
    private val width = box.width
    private val height = box.height
    private val at = IntArray(2)
    val screenW: Int
    val screenH: Int
    private val radiusFrom = dp(context, CORNER_DP).toFloat()
    private val fillBackground = GradientDrawable().apply {
      setColor(card.background)
      cornerRadius = radiusFrom
    }
    private val picture = ImageView(context)
    private val fill = FrameLayout(context)
    private val sheet = FrameLayout(context)
    private val colours = ArgbEvaluator()
    private var ready = false
    var progress = 0f
      private set

    init {
      val size = screenSize(context)
      screenW = size.first
      screenH = size.second
    }

    fun begin() {
      if (width <= 0 || height <= 0) return
      val snapshot = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
      box.draw(Canvas(snapshot))
      box.getLocationOnScreen(at)
      picture.setImageBitmap(snapshot)
      fill.background = fillBackground
      fill.addView(picture, FrameLayout.LayoutParams(width, height, Gravity.TOP or Gravity.START))
      sheet.addView(
        fill,
        FrameLayout.LayoutParams(width, height).apply {
          leftMargin = at[0]
          topMargin = at[1]
        },
      )
      val sheetParams = WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.MATCH_PARENT,
        overlayType(),
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
          WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
          WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
          WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
        PixelFormat.TRANSLUCENT,
      ).apply { gravity = Gravity.TOP or Gravity.START }
      try {
        windowManager(context).addView(sheet, sheetParams)
      } catch (error: RuntimeException) {
        return
      }
      cover?.let { if (it !== sheet) removeCover(it) }
      cover = sheet
      ready = true
      // The sheet shows the card from its first frame; the card's own window keeps the touch but draws nothing.
      box.alpha = 0f
    }

    /** Sets the transition to `p` of the way from the card to the full screen (0 to 1). */
    fun update(p: Float) {
      if (!ready) return
      val t = p.coerceIn(0f, 1f)
      progress = t
      val lp = fill.layoutParams as FrameLayout.LayoutParams
      val left = lerp(at[0], 0, t)
      val top = lerp(at[1], 0, t)
      lp.leftMargin = left
      lp.topMargin = top
      lp.width = lerp(at[0] + width, screenW, t) - left
      lp.height = lerp(at[1] + height, screenH, t) - top
      fill.layoutParams = lp
      val colour = min(1f, t / COLOUR_DONE)
      fillBackground.cornerRadius = radiusFrom * (1f - t)
      fillBackground.setColor(colours.evaluate(colour, card.background, card.screen) as Int)
      picture.alpha = 1f - colour
    }

    private fun animateTo(target: Float, durationMs: Long, onEnd: () -> Unit) {
      ValueAnimator.ofFloat(progress, target).apply {
        duration = durationMs
        interpolator = DecelerateInterpolator(1.6f)
        addUpdateListener { update(it.animatedValue as Float) }
        addListener(object : android.animation.AnimatorListenerAdapter() {
          override fun onAnimationEnd(animation: android.animation.Animator) = onEnd()
        })
        start()
      }
    }

    /** Let go past the mark: finish growing, open Puck beneath, hold, fade the sheet away. */
    fun complete() {
      if (!ready) {
        openApp(context, card.questionId, snooze = false)
        removeView()
        return
      }
      openApp(context, card.questionId, snooze = false)
      main.post { removeView() }
      animateTo(1f, 180L + (320L * (1f - progress)).toLong()) {
        main.postDelayed({ fadeOutCover(sheet) }, COVER_HOLD_MS)
      }
      main.postDelayed({ removeCover(sheet) }, COVER_SAFETY_MS)
    }

    /** Let go early: shrink back onto the card and hand the touch back to it. */
    fun cancel() {
      if (!ready) {
        box.alpha = 1f
        return
      }
      animateTo(0f, 200L) {
        box.alpha = 1f
        removeCover(sheet)
      }
    }
  }

  private fun fadeOutCover(sheet: View) {
    if (cover !== sheet) return
    sheet.animate().alpha(0f).setDuration(COVER_FADE_MS).withEndAction { removeCover(sheet) }.start()
  }

  private fun removeCover(sheet: View) {
    if (cover === sheet) cover = null
    try {
      windowManager(sheet.context).removeView(sheet)
    } catch (error: RuntimeException) {
      // Already gone.
    }
  }

  private fun lerp(from: Int, to: Int, t: Float): Int = (from + (to - from) * t).toInt()

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
      postDelayed(tick, 900L)
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
    bold: Boolean = false,
    maxLines: Int = 1,
    topPaddingDp: Int = 0,
  ): TextView = TextView(context).apply {
    this.text = text
    setTextColor(colour)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
    if (bold) typeface = Typeface.DEFAULT_BOLD
    this.maxLines = maxLines
    ellipsize = android.text.TextUtils.TruncateAt.END
    setPadding(0, dp(context, topPaddingDp), 0, 0)
  }

  private fun dp(context: Context, value: Int): Int =
    (value * context.resources.displayMetrics.density).toInt()
}
