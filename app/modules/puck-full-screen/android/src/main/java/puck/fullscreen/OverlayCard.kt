package puck.fullscreen

import android.animation.ValueAnimator
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.graphics.ColorUtils
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.sign

/**
 * The compact alert card, drawn over other apps. It needs the overlay permission the person grants
 * on Android's "Display over other apps" page; without it nothing is drawn and the notification
 * carries the alert alone. One card at a time. It never takes focus, and touches outside it reach
 * the app underneath. Gestures:
 *
 * - Tap, or swipe down: opens Puck on that alert. A swipe down grows the card into a full-screen
 *   sheet first, so the card feels like it becomes the app.
 * - Swipe sideways: snoozes. The longer the swipe, the longer the snooze, shown under the card as it
 *   moves: 5 minutes, then 10 minutes, then until the person is back. Lifting the finger picks the
 *   length showing; a short swipe springs back and does nothing.
 * - Swipe up (or Dismiss): removes the card and stops the ring. The alert stays in the shade.
 * - The Snooze button removes the card and opens Puck on that alert's snooze choices.
 */
internal object OverlayCard {
  const val EXTRA_QUESTION_ID = "puck.overlayQuestionId"
  const val EXTRA_SNOOZE = "puck.overlaySnooze"
  const val EXTRA_SNOOZE_MINUTES = "puck.overlaySnoozeMinutes"
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
  private const val EXPAND_MS = 380L
  private const val OPEN_AT = 0.5f
  private const val COVER_HOLD_MS = 420L
  private const val COVER_FADE_MS = 240L
  private const val COVER_SAFETY_MS = 4000L
  private const val FLING_UP = -1200f
  private const val FLING_DOWN = 1500f
  private const val TOP_MARGIN_DP = 44
  private const val ROOM_BELOW_DP = 72

  data class Spec(
    val questionId: String,
    val label: String,
    val title: String,
    val body: String,
    val background: Int,
    val ink: Int,
    val ink2: Int,
    val accent: Int,
  )

  data class Opened(val questionId: String, val snooze: Boolean, val snoozeMinutes: Int)

  /** Set by the module: reports a dismiss or snooze to JavaScript while the app is running. */
  @Volatile var onAction: ((questionId: String, action: String) -> Unit)? = null

  private val main = Handler(Looper.getMainLooper())
  private var view: View? = null
  private var params: WindowManager.LayoutParams? = null
  private var cover: View? = null
  private var shownId: String? = null

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

  private fun snoozeLabel(minutes: Int): String = when (minutes) {
    5 -> "Snooze 5 minutes"
    10 -> "Snooze 10 minutes"
    SNOOZE_UNTIL_BACK -> "Snooze until I'm back"
    else -> "Keep going to snooze"
  }

  fun canDraw(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)

  fun show(context: Context, card: Spec): Boolean {
    if (!canDraw(context)) return false
    val app = context.applicationContext
    main.post {
      removeView()
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
      } catch (error: RuntimeException) {
        // The permission was taken back, or the window manager refused the view: no card.
        view = null
        params = null
        shownId = null
      }
    }
    return true
  }

  /** Removes the card when it shows `questionId`, or any card when `questionId` is null. */
  fun hide(questionId: String?) {
    main.post {
      if (questionId == null || questionId == shownId) removeView()
    }
  }

  /** The alert a tap on the card opened (a cold start) and the snooze it chose, if any; taken once. */
  fun takeOpened(activityIntent: Intent?): Opened? {
    val id = activityIntent?.getStringExtra(EXTRA_QUESTION_ID) ?: return null
    val snooze = activityIntent.getBooleanExtra(EXTRA_SNOOZE, false)
    val minutes = activityIntent.getIntExtra(EXTRA_SNOOZE_MINUTES, SNOOZE_CHOICES)
    activityIntent.removeExtra(EXTRA_QUESTION_ID)
    activityIntent.removeExtra(EXTRA_SNOOZE)
    activityIntent.removeExtra(EXTRA_SNOOZE_MINUTES)
    return Opened(id, snooze, minutes)
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

  private class Parts(val root: FrameLayout, val box: View, val underlay: TextView)

  private fun buildView(context: Context, card: Spec): View {
    val box = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(context, 16), dp(context, 14), dp(context, 16), dp(context, 14))
      background = GradientDrawable().apply {
        setColor(card.background)
        cornerRadius = dp(context, 18).toFloat()
      }
      elevation = dp(context, 10).toFloat()
      setOnClickListener { openApp(context, card.questionId, snooze = false); removeView() }
    }
    box.addView(line(context, card.label, card.accent, 12f, bold = true))
    box.addView(line(context, card.title, card.ink, 16f, bold = true, maxLines = 1))
    box.addView(line(context, card.body, card.ink2, 14f, maxLines = 2))
    box.addView(line(context, "Sideways: snooze   Up: hide   Down: open", card.ink2, 12f, topPaddingDp = 6))
    box.addView(actionRow(context, card))

    // Under the card: what a sideways swipe would pick, revealed as the card moves aside.
    val underlay = TextView(context).apply {
      setTextColor(card.ink)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
      typeface = Typeface.DEFAULT_BOLD
      setPadding(dp(context, 24), 0, dp(context, 24), 0)
      gravity = Gravity.CENTER_VERTICAL or Gravity.START
      background = GradientDrawable().apply {
        setColor(ColorUtils.blendARGB(card.background, card.accent, 0.22f))
        cornerRadius = dp(context, 18).toFloat()
      }
      visibility = View.INVISIBLE
    }

    val root = FrameLayout(context).apply {
      setPadding(dp(context, 12), 0, dp(context, 12), 0)
      addView(underlay, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
      addView(box, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
    }
    attachGestures(context, Parts(root, box, underlay), card)
    return root
  }

  private fun actionRow(context: Context, card: Spec): View = LinearLayout(context).apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = Gravity.END
    setPadding(0, dp(context, 6), 0, 0)
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

  private enum class Axis { NONE, HORIZONTAL, VERTICAL }

  /**
   * One finger on the card. The first move past the touch slop picks the axis: sideways reveals and
   * picks a snooze length, vertical hides (up) or opens (down). Positions use raw screen
   * coordinates, so growing the window while a vertical drag runs does not disturb them.
   */
  private fun attachGestures(context: Context, parts: Parts, card: Spec) {
    val box = parts.box
    val slop = ViewConfiguration.get(context).scaledTouchSlop
    var downX = 0f
    var downY = 0f
    var axis = Axis.NONE
    var minutes = 0
    var tracker: VelocityTracker? = null

    fun finish() {
      tracker?.recycle()
      tracker = null
      axis = Axis.NONE
      minutes = 0
    }

    fun settleBack() {
      box.animate().translationX(0f).translationY(0f).alpha(1f).setDuration(SETTLE_MS)
        .withEndAction { parts.underlay.visibility = View.INVISIBLE; setRoom(parts.root, false) }
        .start()
    }

    box.setOnTouchListener { _, event ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downX = event.rawX
          downY = event.rawY
          axis = Axis.NONE
          minutes = 0
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
            // Room above and below, so a vertical drag is not cut off at the card's own edges.
            if (axis == Axis.VERTICAL) setRoom(parts.root, true)
            if (axis == Axis.HORIZONTAL) parts.underlay.visibility = View.VISIBLE
          }
          when (axis) {
            Axis.HORIZONTAL -> {
              box.translationX = dx
              box.alpha = 1f - 0.25f * min(abs(dx) / box.width, 1f)
              val next = snoozeMinutesFor(abs(dx) / box.width)
              if (next != minutes) {
                minutes = next
                parts.underlay.text = snoozeLabel(next)
                parts.underlay.gravity = Gravity.CENTER_VERTICAL or (if (dx > 0) Gravity.START else Gravity.END)
                box.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
              } else if (dx != 0f) {
                parts.underlay.gravity = Gravity.CENTER_VERTICAL or (if (dx > 0) Gravity.START else Gravity.END)
              }
            }
            Axis.VERTICAL -> {
              // Up follows the finger and fades; down is held back so it reads as a pull, not a drop.
              if (dy < 0) {
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
              dy < 0 && (-dy > box.height * 0.4f || vy < FLING_UP) -> {
                box.animate()
                  .translationY(-(box.height + dp(context, TOP_MARGIN_DP)).toFloat())
                  .alpha(0f)
                  .setDuration(SETTLE_MS)
                  .withEndAction { release(context, card.questionId, ACTION_DISMISS) }
                  .start()
              }
              dy > 0 && (dy > dp(context, 56) || vy > FLING_DOWN) -> expandAndOpen(context, box, card)
              else -> settleBack()
            }
          }
          finish()
          true
        }
        MotionEvent.ACTION_CANCEL -> {
          if (axis != Axis.NONE) settleBack()
          finish()
          true
        }
        else -> false
      }
    }
  }

  /**
   * Gives a vertical drag space: the window starts at the top of the screen with the card's usual
   * gap as padding, and keeps extra room below. Touches in that room belong to the card window
   * only while a drag lasts; `on = false` puts the window back to the card's own size.
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
   * The swipe-down transition. A full-screen sheet in the card's colour starts exactly where the
   * card is, with a picture of the card on it, and grows to fill the screen while the picture fades
   * and the corners square off. Puck is started about half way through, so it is drawing under the
   * sheet when the sheet is done; the sheet then holds a moment and fades away onto the alert.
   */
  private fun expandAndOpen(context: Context, box: View, card: Spec) {
    val width = box.width
    val height = box.height
    if (width <= 0 || height <= 0) {
      openApp(context, card.questionId, snooze = false)
      removeView()
      return
    }
    val snapshot = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    box.draw(Canvas(snapshot))
    val at = IntArray(2)
    box.getLocationOnScreen(at)
    val (screenW, screenH) = screenSize(context)
    val radiusFrom = dp(context, 18).toFloat()

    val fillBackground = GradientDrawable().apply {
      setColor(card.background)
      cornerRadius = radiusFrom
    }
    val picture = ImageView(context).apply { setImageBitmap(snapshot) }
    val fill = FrameLayout(context).apply {
      background = fillBackground
      addView(picture, FrameLayout.LayoutParams(width, height, Gravity.TOP or Gravity.START))
    }
    val sheet = FrameLayout(context).apply {
      addView(
        fill,
        FrameLayout.LayoutParams(width, height).apply {
          leftMargin = at[0]
          topMargin = at[1]
        },
      )
    }
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

    val manager = windowManager(context)
    try {
      cover?.let { manager.removeView(it) }
    } catch (error: RuntimeException) {
      // Already gone.
    }
    cover = null
    try {
      manager.addView(sheet, sheetParams)
    } catch (error: RuntimeException) {
      openApp(context, card.questionId, snooze = false)
      removeView()
      return
    }
    cover = sheet
    // The sheet is up and looks like the card, so the card can go without a visible change.
    sheet.post { removeView() }

    var opened = false
    ValueAnimator.ofFloat(0f, 1f).apply {
      duration = EXPAND_MS
      interpolator = PathInterpolator(0.2f, 0f, 0f, 1f)
      addUpdateListener { animator ->
        val t = animator.animatedValue as Float
        val lp = fill.layoutParams as FrameLayout.LayoutParams
        lp.leftMargin = lerp(at[0], 0, t)
        lp.topMargin = lerp(at[1], 0, t)
        lp.width = lerp(width, screenW, t)
        lp.height = lerp(height, screenH, t)
        fill.layoutParams = lp
        fillBackground.cornerRadius = radiusFrom * (1f - t)
        picture.alpha = 1f - min(1f, t * 2.5f)
        if (!opened && t >= OPEN_AT) {
          opened = true
          openApp(context, card.questionId, snooze = false)
        }
      }
      start()
    }
    main.postDelayed({ fadeOutCover(sheet) }, EXPAND_MS + COVER_HOLD_MS)
    main.postDelayed({ removeCover(sheet) }, COVER_SAFETY_MS)
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
