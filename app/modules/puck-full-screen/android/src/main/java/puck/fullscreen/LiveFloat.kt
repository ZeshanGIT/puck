package puck.fullscreen

import android.animation.ValueAnimator
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.RectF
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
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.graphics.ColorUtils
import androidx.core.graphics.PathParser
import kotlin.math.hypot
import kotlin.math.min

/**
 * A bot's live task floating over other apps, for bots the person turned it on for. It sits as a
 * small pill at the screen edge (the bot's avatar inside a ring that fills as the steps go by); a
 * tap opens it into a card with the task, the step and the note, and a tap again folds it back.
 * Dragging moves it (it snaps to the nearest side); dragging it onto the target at the bottom, or
 * the card's ×, hides it until the task moves to another step or ends. A failure always shows. A
 * finished task shows briefly and goes. The shade notification is separate and always stays.
 *
 * JavaScript decides when to call `show` (the bot's setting, the overlay permission); this keeps
 * where the pill sits and what was dismissed, so a headless start knows too.
 */
object LiveFloat {
  data class Spec(
    val activityId: String,
    val botName: String,
    val title: String,
    /** "Test · 3 to go", or the closing line ("Finished"). */
    val stepLine: String,
    val note: String?,
    /** running, done, failed or stale. */
    val state: String,
    /** Changes when the task moves to another step: a dismissal lasts until then. */
    val stepKey: String,
    /** 0 to 1 along the steps; null for a task with no steps. */
    val progress: Float?,
    val background: Int,
    val ink: Int,
    val ink2: Int,
    val botColour: Int,
    val blobFill: Int,
    val blobRim: Int?,
    val blobPath: String,
    val blobTilt: Float,
    val ok: Int,
    val danger: Int,
  )

  private const val PREFS = "puck.liveFloat"
  private const val PILL_DP = 60
  private const val BLOB_DP = 38
  private const val CARD_DP = 236
  private const val DONE_SHOW_MS = 6_000L
  private const val TARGET_DP = 64

  private val main = Handler(Looper.getMainLooper())
  private var root: LinearLayout? = null
  private var params: WindowManager.LayoutParams? = null
  private var current: Spec? = null
  private var expanded = false
  private var onRight = true
  private var target: View? = null
  private var ring: RingView? = null
  private var blob: BlobView? = null
  private var card: LinearLayout? = null
  private val autoHide = Runnable { hideNow() }

  fun canDraw(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)

  /** Shows or updates the pill for this update, unless it was dismissed for this step. */
  fun show(context: Context, spec: Spec) {
    val app = context.applicationContext
    main.post {
      if (!canDraw(app)) return@post
      val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val dismissedId = prefs.getString("dismissedActivity", null)
      val dismissedKey = prefs.getString("dismissedStep", null)
      val dismissedHere = dismissedId == spec.activityId
      when (spec.state) {
        "failed" -> prefs.edit().remove("dismissedActivity").remove("dismissedStep").apply()
        "running" -> if (dismissedHere && dismissedKey == spec.stepKey) { hideNow(); return@post }
        else -> if (dismissedHere) { hideNow(); return@post }
      }
      main.removeCallbacks(autoHide)
      val sameTask = current?.activityId == spec.activityId && root != null
      current = spec
      if (sameTask) update(spec) else attach(app, spec)
      if (spec.state == "done" || spec.state == "stale") main.postDelayed(autoHide, DONE_SHOW_MS)
    }
  }

  /** Takes the pill away (the task was replaced, or the person turned it off). */
  fun hide(activityId: String?) {
    main.post { if (activityId == null || current?.activityId == activityId) hideNow() }
  }

  private fun hideNow() {
    main.removeCallbacks(autoHide)
    val wm = root?.context?.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
    root?.let { view -> try { wm?.removeView(view) } catch (_: RuntimeException) {} }
    removeTarget()
    root = null
    params = null
    current = null
    ring = null
    blob = null
    card = null
    expanded = false
  }

  private fun dismiss(context: Context) {
    val spec = current ?: return
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString("dismissedActivity", spec.activityId)
      .putString("dismissedStep", spec.stepKey)
      .apply()
    hideNow()
  }

  private fun attach(context: Context, spec: Spec) {
    hideNow()
    current = spec
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    onRight = prefs.getBoolean("onRight", true)
    val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val metrics = context.resources.displayMetrics
    val view = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      clipChildren = false
      clipToPadding = false
      setPadding(dp(context, 8), dp(context, 8), dp(context, 8), dp(context, 8))
    }
    val pill = FrameLayout(context).apply {
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(spec.background)
        setStroke(dp(context, 1), ColorUtils.setAlphaComponent(spec.ink, 0x2E))
      }
      elevation = dpF(context, 8f)
      contentDescription = "${spec.botName}: ${spec.title}"
    }
    val ringView = RingView(context)
    pill.addView(ringView, FrameLayout.LayoutParams(dp(context, PILL_DP), dp(context, PILL_DP)))
    val blobView = BlobView(context)
    pill.addView(blobView, FrameLayout.LayoutParams(dp(context, BLOB_DP), dp(context, BLOB_DP), Gravity.CENTER))
    val cardView = buildCard(context)
    view.addView(pill, LinearLayout.LayoutParams(dp(context, PILL_DP), dp(context, PILL_DP)))
    ring = ringView
    blob = blobView
    card = cardView
    root = view
    placeCard(context)
    update(spec)

    val layoutParams = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      overlayType(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      val width = dp(context, PILL_DP + 16)
      x = if (onRight) metrics.widthPixels - width else 0
      y = prefs.getInt("y", (metrics.heightPixels * 0.32f).toInt())
    }
    params = layoutParams
    attachTouch(context, pill, view, wm)
    try {
      wm.addView(view, layoutParams)
    } catch (_: RuntimeException) {
      root = null
      params = null
    }
  }

  private fun buildCard(context: Context): LinearLayout = LinearLayout(context).apply {
    orientation = LinearLayout.VERTICAL
    elevation = dpF(context, 8f)
    setPadding(dp(context, 16), dp(context, 12), dp(context, 10), dp(context, 14))
    visibility = View.GONE
    setOnClickListener { openPuck(context) }
  }

  /** The card's contents for this update: the bot, a ×, the task, the step line and the note. */
  private fun fillCard(context: Context, spec: Spec) {
    val view = card ?: return
    view.removeAllViews()
    view.background = GradientDrawable().apply {
      cornerRadius = dpF(context, 20f)
      setColor(spec.background)
      setStroke(dp(context, 1), ColorUtils.setAlphaComponent(spec.ink, 0x2E))
    }
    val head = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    head.addView(text(context, spec.botName, spec.ink2, 12.5f, font(context, "Nunito_800ExtraBold.ttf")), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
    val close = text(context, "×", spec.ink2, 20f, font(context, "Nunito_800ExtraBold.ttf")).apply {
      setPadding(dp(context, 10), 0, dp(context, 4), 0)
      contentDescription = "Hide until the next step"
      setOnClickListener { performHapticFeedback(HapticFeedbackConstants.CONFIRM); dismiss(context) }
    }
    head.addView(close)
    view.addView(head)
    view.addView(text(context, spec.title, spec.ink, 16f, font(context, "Nunito_900Black.ttf"), 2).apply { setPadding(0, dp(context, 2), 0, 0) })
    val stepColour = when (spec.state) {
      "done" -> spec.ok
      "failed" -> spec.danger
      else -> spec.botColour
    }
    view.addView(text(context, spec.stepLine, stepColour, 13.5f, font(context, "Nunito_800ExtraBold.ttf")).apply { setPadding(0, dp(context, 4), 0, 0) })
    if (!spec.note.isNullOrBlank()) {
      view.addView(text(context, spec.note, spec.ink2, 13.5f, font(context, "Nunito_700Bold.ttf"), 3).apply { setPadding(0, dp(context, 3), 0, 0) })
    }
  }

  private fun update(spec: Spec) {
    val view = root ?: return
    ring?.set(spec)
    blob?.set(spec)
    fillCard(view.context, spec)
    // A failure opens the card by itself: that is when the person most wants to know.
    if (spec.state == "failed" && !expanded) toggle(view.context)
    view.contentDescription = "${spec.botName}: ${spec.title}. ${spec.stepLine}"
  }

  private fun placeCard(context: Context) {
    val view = root ?: return
    val cardView = card ?: return
    val pill = (0 until view.childCount).map { view.getChildAt(it) }.firstOrNull { it !== cardView } ?: return
    view.removeAllViews()
    val cardParams = LinearLayout.LayoutParams(dp(context, CARD_DP), LinearLayout.LayoutParams.WRAP_CONTENT).apply {
      if (onRight) rightMargin = dp(context, 8) else leftMargin = dp(context, 8)
    }
    if (onRight) {
      view.addView(cardView, cardParams)
      view.addView(pill)
    } else {
      view.addView(pill)
      view.addView(cardView, cardParams)
    }
  }

  private fun toggle(context: Context) {
    val view = root ?: return
    val cardView = card ?: return
    val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val layoutParams = params ?: return
    val metrics = context.resources.displayMetrics
    expanded = !expanded
    cardView.visibility = if (expanded) View.VISIBLE else View.GONE
    // On the right edge the window grows to the left, so the pill stays where it was.
    val width = dp(context, PILL_DP + 16) + if (expanded) dp(context, CARD_DP + 8) else 0
    if (onRight) layoutParams.x = metrics.widthPixels - width
    try { wm.updateViewLayout(view, layoutParams) } catch (_: RuntimeException) {}
  }

  private fun attachTouch(context: Context, pill: View, view: View, wm: WindowManager) {
    val slop = ViewConfiguration.get(context).scaledTouchSlop
    var downX = 0f
    var downY = 0f
    var startX = 0
    var startY = 0
    var dragging = false
    pill.setOnTouchListener { touched, event ->
      val layoutParams = params ?: return@setOnTouchListener false
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downX = event.rawX
          downY = event.rawY
          startX = layoutParams.x
          startY = layoutParams.y
          dragging = false
          true
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = event.rawX - downX
          val dy = event.rawY - downY
          if (!dragging && hypot(dx, dy) > slop) {
            dragging = true
            if (expanded) toggle(context)
            showTarget(context)
          }
          if (dragging) {
            layoutParams.x = (startX + dx).toInt()
            layoutParams.y = (startY + dy).toInt()
            try { wm.updateViewLayout(view, layoutParams) } catch (_: RuntimeException) {}
            highlightTarget(context, overTarget(context, event.rawX, event.rawY))
          }
          true
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          if (!dragging) {
            if (event.actionMasked == MotionEvent.ACTION_UP) {
              touched.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
              toggle(context)
            }
          } else if (overTarget(context, event.rawX, event.rawY)) {
            touched.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
            removeTarget()
            dismiss(context)
          } else {
            removeTarget()
            snap(context, view, wm, event.rawX)
          }
          dragging = false
          true
        }
        else -> false
      }
    }
  }

  /** Back to the nearest side, and remembered there. */
  private fun snap(context: Context, view: View, wm: WindowManager, rawX: Float) {
    val layoutParams = params ?: return
    val metrics = context.resources.displayMetrics
    val wasRight = onRight
    onRight = rawX > metrics.widthPixels / 2f
    if (wasRight != onRight) placeCard(context)
    val width = dp(context, PILL_DP + 16)
    val toX = if (onRight) metrics.widthPixels - width else 0
    val fromX = layoutParams.x
    layoutParams.y = layoutParams.y.coerceIn(dp(context, 24), metrics.heightPixels - dp(context, PILL_DP + 80))
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putBoolean("onRight", onRight)
      .putInt("y", layoutParams.y)
      .apply()
    ValueAnimator.ofFloat(0f, 1f).apply {
      duration = 220L
      interpolator = DecelerateInterpolator()
      addUpdateListener {
        layoutParams.x = (fromX + (toX - fromX) * (it.animatedValue as Float)).toInt()
        try { wm.updateViewLayout(view, layoutParams) } catch (_: RuntimeException) {}
      }
      start()
    }
  }

  /* --------------------------------------------------------------- dismiss target */

  private fun showTarget(context: Context) {
    if (target != null) return
    val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val spec = current ?: return
    val view = TextView(context).apply {
      text = "×"
      gravity = Gravity.CENTER
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 28f)
      typeface = font(context, "Nunito_800ExtraBold.ttf")
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(ColorUtils.setAlphaComponent(spec.ink, 0x99))
      }
      contentDescription = "Drop here to hide"
    }
    val layoutParams = WindowManager.LayoutParams(
      dp(context, TARGET_DP),
      dp(context, TARGET_DP),
      overlayType(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
      y = dp(context, 56)
    }
    try {
      wm.addView(view, layoutParams)
      target = view
    } catch (_: RuntimeException) {}
  }

  private fun highlightTarget(context: Context, over: Boolean) {
    val view = target ?: return
    val spec = current ?: return
    (view.background as? GradientDrawable)?.setColor(if (over) spec.danger else ColorUtils.setAlphaComponent(spec.ink, 0x99))
    view.scaleX = if (over) 1.18f else 1f
    view.scaleY = if (over) 1.18f else 1f
  }

  private fun overTarget(context: Context, rawX: Float, rawY: Float): Boolean {
    val metrics = context.resources.displayMetrics
    val cx = metrics.widthPixels / 2f
    val cy = metrics.heightPixels - dpF(context, 56f + TARGET_DP / 2f)
    return hypot(rawX - cx, rawY - cy) < dpF(context, 72f)
  }

  private fun removeTarget() {
    val view = target ?: return
    val wm = view.context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
    try { wm?.removeView(view) } catch (_: RuntimeException) {}
    target = null
  }

  /* ------------------------------------------------------------------------ views */

  /** The ring around the avatar: the steps done so far, or a turning arc for a task with no steps. */
  private class RingView(context: Context) : View(context) {
    private var spec: Spec? = null
    private var spin = 0f
    private var spinner: ValueAnimator? = null
    private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    private val arc = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    private val box = RectF()

    fun set(next: Spec) {
      spec = next
      val stroke = dpF(context, 4f)
      track.strokeWidth = stroke
      arc.strokeWidth = stroke
      track.color = ColorUtils.setAlphaComponent(next.ink, 0x22)
      arc.color = when (next.state) {
        "done" -> next.ok
        "failed" -> next.danger
        else -> next.botColour
      }
      val spinning = next.state == "running" && next.progress == null && motionOn()
      if (spinning && spinner == null) {
        spinner = ValueAnimator.ofFloat(0f, 360f).apply {
          duration = 1600L
          repeatCount = ValueAnimator.INFINITE
          interpolator = null
          addUpdateListener { spin = it.animatedValue as Float; invalidate() }
          start()
        }
      } else if (!spinning) {
        spinner?.cancel()
        spinner = null
      }
      invalidate()
    }

    override fun onDetachedFromWindow() {
      spinner?.cancel()
      spinner = null
      super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
      val current = spec ?: return
      val inset = dpF(context, 4f)
      box.set(inset, inset, width - inset, height - inset)
      canvas.drawOval(box, track)
      when {
        current.state != "running" -> canvas.drawOval(box, arc)
        current.progress != null -> canvas.drawArc(box, -90f, 360f * current.progress.coerceIn(0.02f, 1f), false, arc)
        else -> canvas.drawArc(box, spin - 90f, 90f, false, arc)
      }
    }
  }

  /** The bot's avatar: its body and eyes, still. */
  private class BlobView(context: Context) : View(context) {
    private var body = Path()
    private var tilt = 0f
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val rim = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 2f }
    private var hasRim = false
    private val eyePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; style = Paint.Style.FILL }
    private val eyes = listOf(RectF(56f, 25f, 64.5f, 45f), RectF(70f, 26f, 78.5f, 46f))

    fun set(spec: Spec) {
      body = try {
        PathParser.createPathFromPathData(spec.blobPath) ?: circle()
      } catch (_: RuntimeException) {
        circle()
      }
      tilt = spec.blobTilt
      fill.color = spec.blobFill
      hasRim = spec.blobRim != null
      rim.color = spec.blobRim ?: 0
      invalidate()
    }

    private fun circle() = Path().apply { addCircle(50f, 50f, 43f, Path.Direction.CW) }

    override fun onDraw(canvas: Canvas) {
      val unit = min(width, height) / 100f
      canvas.save()
      canvas.scale(unit, unit)
      canvas.save()
      canvas.rotate(tilt, 50f, 50f)
      canvas.drawPath(body, fill)
      if (hasRim) canvas.drawPath(body, rim)
      canvas.restore()
      canvas.rotate(-12f, 66f, 36f)
      for (eye in eyes) canvas.drawRoundRect(eye, 4.25f, 4.25f, eyePaint)
      canvas.restore()
    }
  }

  /* ---------------------------------------------------------------------- helpers */

  private fun openPuck(context: Context) {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    try { context.startActivity(launch) } catch (_: RuntimeException) {}
  }

  private val faces = HashMap<String, Typeface>()

  private fun font(context: Context, file: String): Typeface = faces.getOrPut(file) {
    try {
      Typeface.createFromAsset(context.applicationContext.assets, "puck-fonts/$file")
    } catch (_: RuntimeException) {
      Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    }
  }

  private fun text(context: Context, value: String, colour: Int, sizeSp: Float, face: Typeface, lines: Int = 1): TextView =
    TextView(context).apply {
      text = value
      setTextColor(colour)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
      typeface = face
      includeFontPadding = false
      maxLines = lines
      ellipsize = android.text.TextUtils.TruncateAt.END
    }

  private fun overlayType(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }

  private fun motionOn(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.O || ValueAnimator.areAnimatorsEnabled()

  private fun dp(context: Context, value: Int): Int = (value * context.resources.displayMetrics.density).toInt()

  private fun dpF(context: Context, value: Float): Float = value * context.resources.displayMetrics.density

}
