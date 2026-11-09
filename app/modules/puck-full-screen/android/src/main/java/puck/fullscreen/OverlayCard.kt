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
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.graphics.ColorUtils
import androidx.core.graphics.PathParser
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sign
import kotlin.random.Random

/**
 * The compact alert card, drawn over other apps. It needs the overlay permission the person grants
 * on Android's "Display over other apps" page; without it nothing is drawn and the notification
 * carries the alert alone. One card at a time. It never takes focus, and touches outside it reach
 * the app underneath. The card wears the bot: its blob (with eyes that glance and blink) and a wash
 * of its colour. Gestures:
 *
 * - Tap: opens Puck on that alert.
 * - Pull down: the card grows with the finger into a full-screen sheet (white, or dark in the dark
 *   theme). Let go past a short pull and the sheet finishes growing while Puck opens beneath it and
 *   the sheet fades away onto the alert; let go early and the card springs back.
 * - Swipe sideways: snoozes. The card slides aside and the length shows under it in the bot's colour:
 *   5 minutes, then 10 minutes, then until the person is back. Lifting the finger picks the length
 *   showing; a short swipe springs back and does nothing.
 * - Swipe up (or Dismiss): removes the card and stops the ring. The alert stays in the shade.
 * - The Snooze button removes the card and opens Puck on that alert's snooze choices.
 */
internal object OverlayCard {
  const val EXTRA_QUESTION_ID = "puck.overlayQuestionId"
  const val EXTRA_SNOOZE = "puck.overlaySnooze"
  const val EXTRA_SNOOZE_MINUTES = "puck.overlaySnoozeMinutes"
  const val EXTRA_NONCE = "puck.overlayNonce"
  const val ACTION_DISMISS = "dismiss"
  const val ACTION_SNOOZE = "snooze"

  /** Sent as the snooze length for "until I'm back"; 0 means "show the snooze choices". */
  const val SNOOZE_UNTIL_BACK = -1
  const val SNOOZE_CHOICES = 0

  // How far a sideways drag has gone, as a share of the card's width, where each length starts.
  private const val FIVE_MIN_FRACTION = 0.12f
  private const val TEN_MIN_FRACTION = 0.38f
  private const val UNTIL_BACK_FRACTION = 0.65f

  private const val SETTLE_MS = 150L
  private const val COVER_HOLD_MS = 380L
  private const val COVER_FADE_MS = 320L
  private const val COVER_SAFETY_MS = 4000L
  private const val FLING_UP = -1200f
  private const val FLING_DOWN = 1500f
  private const val TOP_MARGIN_DP = 44
  private const val ROOM_BELOW_DP = 72
  private const val CORNER_DP = 22

  // A pull down reaches the full screen after this share of the screen height, and lets go into the
  // app once it has passed this share of that distance.
  private const val FULL_PULL_FRACTION = 0.5f
  private const val OPEN_PROGRESS = 0.18f

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

  /** Set by the module: reports a dismiss or snooze to JavaScript while the app is running. */
  @Volatile var onAction: ((questionId: String, action: String) -> Unit)? = null

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
   * The snooze length a sideways drag of `fraction` of the card's width would pick: 0 before the
   * first mark (nothing yet), then 5, 10, or [SNOOZE_UNTIL_BACK].
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
        y = dp(app, TOP_MARGIN_DP)
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
    onAction?.invoke(questionId, action)
  }

  private const val TAG_BOX = "puck-card-box"
  private const val TAG_BLOB = "puck-card-blob"

  /** The pieces of the sideways reveal that change while the card is dragged. */
  private class Reveal(
    val layout: LinearLayout,
    val emoji: TextView,
    val big: TextView,
    val small: TextView,
  )

  private class Parts(val root: FrameLayout, val box: View, val reveal: Reveal)

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
      elevation = dp(context, 10).toFloat()
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
    box.addView(line(context, "◀ snooze ▶    ▲ hide    ▼ open", card.ink2, 11f, topPaddingDp = 8))
    box.addView(actionRow(context, card))

    // Under the card, the bot's colour and what a sideways swipe would pick.
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
    val layout = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL or Gravity.START
      setPadding(dp(context, 26), 0, dp(context, 26), 0)
      background = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        intArrayOf(card.botColour, card.botDeep),
      ).apply { cornerRadius = corner }
      visibility = View.INVISIBLE
      addView(emoji)
      addView(big)
      addView(small)
    }
    val reveal = Reveal(layout, emoji, big, small)

    val root = FrameLayout(context).apply {
      setPadding(dp(context, 12), 0, dp(context, 12), 0)
      addView(layout, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
      addView(box, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
    }
    attachGestures(context, Parts(root, box, reveal), card)
    return root
  }

  private fun actionRow(context: Context, card: Spec): View = LinearLayout(context).apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = Gravity.END
    setPadding(0, dp(context, 2), 0, 0)
    addView(action(context, "Dismiss", card.ink2) { release(context, card.questionId, ACTION_DISMISS) })
    addView(action(context, "Snooze", card.accent) {
      release(context, card.questionId, ACTION_SNOOZE)
      openApp(context, card.questionId, snooze = true, snoozeMinutes = SNOOZE_CHOICES)
    })
  }

  private fun action(context: Context, label: String, colour: Int, onClick: () -> Unit): TextView =
    TextView(context).apply {
      text = label
      setTextColor(colour)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
      typeface = Typeface.DEFAULT_BOLD
      setPadding(dp(context, 12), dp(context, 8), dp(context, 12), dp(context, 8))
      isClickable = true
      isFocusable = true
      val outValue = TypedValue()
      context.theme.resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, outValue, true)
      setBackgroundResource(outValue.resourceId)
      setOnClickListener { onClick() }
    }

  /** Sets the reveal's text for a snooze length and which side it sits on. */
  private fun setReveal(reveal: Reveal, minutes: Int, towardRight: Boolean, bump: Boolean) {
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
    reveal.layout.gravity = Gravity.CENTER_VERTICAL or (if (towardRight) Gravity.START else Gravity.END)
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
   * One finger on the card. The first move past the touch slop picks the axis: sideways reveals and
   * picks a snooze length, vertical hides (up) or opens (down). Positions use raw screen
   * coordinates, so changes to the card's own window while a drag runs do not disturb them. The
   * pull-down is drawn by a separate full-screen window, so it is never cut off by the card's
   * window; the card window stays under the finger to keep receiving the touch.
   */
  private fun attachGestures(context: Context, parts: Parts, card: Spec) {
    val box = parts.box
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
                expander = Expander(context, box, card).also { it.begin() }
              } else {
                // Room above, so an upward drag is not cut off at the card's own top edge.
                setRoom(parts.root, true)
              }
            }
            if (axis == Axis.HORIZONTAL) {
              setReveal(parts.reveal, 0, dx > 0, bump = false)
              parts.reveal.layout.visibility = View.VISIBLE
            }
          }
          when (axis) {
            Axis.HORIZONTAL -> {
              box.translationX = dx
              box.alpha = 1f - 0.25f * min(abs(dx) / box.width, 1f)
              val next = snoozeMinutesFor(abs(dx) / box.width)
              val changed = next != minutes
              if (changed) {
                minutes = next
                box.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
              }
              if (changed || dx != 0f) setReveal(parts.reveal, minutes, dx > 0, bump = changed)
            }
            Axis.VERTICAL -> {
              val grow = expander
              if (grow != null) {
                grow.update(max(dy, 0f) / (grow.screenH * FULL_PULL_FRACTION))
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
            Axis.HORIZONTAL -> {
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
            }
            Axis.VERTICAL -> when {
              grow != null ->
                if (grow.progress > OPEN_PROGRESS || vy > FLING_DOWN) grow.complete() else grow.cancel()
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
   * Gives an upward drag space: the window starts at the top of the screen with the card's usual
   * gap as padding. Touches in that gap belong to the card window only while a drag lasts; `on =
   * false` puts the window back to the card's own size.
   */
  private fun setRoom(root: FrameLayout, on: Boolean) {
    val current = params ?: return
    if (view !== root) return
    val context = root.context
    val side = dp(context, 12)
    if (on) {
      current.y = 0
      root.setPadding(side, dp(context, TOP_MARGIN_DP), side, dp(context, ROOM_BELOW_DP))
    } else {
      current.y = dp(context, TOP_MARGIN_DP)
      root.setPadding(side, 0, side, 0)
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
   * starts exactly as the card (a picture of it on the card colour) grows with `progress` (0 to 1)
   * to fill the screen in the app's background colour while the picture fades and the corners
   * square off. [complete] finishes the growth, starts Puck beneath, holds a moment and fades the
   * sheet away so the alert appears to come in through it. [cancel] shrinks it back onto the card.
   */
  private class Expander(private val context: Context, private val box: View, private val card: Spec) {
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
      // The sheet shows the card now; the card's own window keeps the touch but draws nothing.
      sheet.post { box.alpha = 0f }
    }

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
      fillBackground.cornerRadius = radiusFrom * (1f - t)
      fillBackground.setColor(colours.evaluate(min(1f, t * 1.4f), card.background, card.screen) as Int)
      picture.alpha = 1f - min(1f, t * 3f)
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
