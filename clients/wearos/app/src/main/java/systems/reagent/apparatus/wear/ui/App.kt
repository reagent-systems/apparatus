package systems.reagent.apparatus.wear.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import kotlin.math.PI
import kotlin.math.sin
import systems.reagent.apparatus.wear.AppViewModel
import systems.reagent.apparatus.wear.FeedLine
import systems.reagent.apparatus.wear.OrbState
import systems.reagent.apparatus.wear.R
import systems.reagent.apparatus.wear.Speaker
import systems.reagent.apparatus.wear.UiState

@Composable
fun App(viewModel: AppViewModel) {
    val ui by viewModel.ui.collectAsState()
    MaterialTheme {
        Screen(ui, onPress = viewModel::pressTalk, onRelease = viewModel::releaseTalk, onStop = viewModel::stop)
    }
}

/** The feed on top, the orb, then Talk and Stop. State shows through the orb and the feed. */
@Composable
fun Screen(ui: UiState, onPress: () -> Unit, onRelease: () -> Unit, onStop: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().background(MaterialTheme.colors.background),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Feed(ui.feed, ui.partial, Modifier.weight(1f).fillMaxWidth())
        Orb(ui.orb, ui.level, Modifier.size(56.dp))
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            TalkButton(active = ui.orb == OrbState.Listening, enabled = ui.live, onPress = onPress, onRelease = onRelease)
            StopButton(onStop)
        }
        Spacer(Modifier.height(10.dp))
    }
}

@Composable
private fun Feed(lines: List<FeedLine>, partial: FeedLine?, modifier: Modifier) {
    val state = rememberScalingLazyListState()
    val count = lines.size + (if (partial != null) 1 else 0)
    LaunchedEffect(count, partial?.text) {
        if (count > 0) state.scrollToItem(count - 1)
    }
    ScalingLazyColumn(
        modifier = modifier,
        state = state,
        autoCentering = null,
        contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 22.dp, bottom = 6.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        items(lines, key = { it.id }) { Line(it, partial = false) }
        if (partial != null) item(key = partial.id) { Line(partial, partial = true) }
    }
}

@Composable
private fun Line(line: FeedLine, partial: Boolean) {
    val color = when {
        partial -> MaterialTheme.colors.onSurfaceVariant.copy(alpha = 0.7f)
        line.speaker == Speaker.User -> MaterialTheme.colors.onSurfaceVariant
        else -> MaterialTheme.colors.onBackground
    }
    Text(
        text = line.text,
        color = color,
        style = MaterialTheme.typography.body2,
        textAlign = TextAlign.Center,
        maxLines = 4,
        overflow = TextOverflow.Ellipsis,
    )
}

/**
 * One circle. Idle: small and still. Listening: grows with the microphone level.
 * Speaking: a slow pulse. Working: a ring runs around it.
 */
@Composable
fun Orb(state: OrbState, level: Float, modifier: Modifier = Modifier) {
    val transition = rememberInfiniteTransition(label = "orb")
    val phase by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(durationMillis = 1600, easing = LinearEasing)),
        label = "phase",
    )
    val base by animateFloatAsState(
        targetValue = when (state) {
            OrbState.Idle -> 0.62f
            OrbState.Listening -> 0.72f
            OrbState.Speaking -> 0.84f
            OrbState.Working -> 0.62f
        },
        animationSpec = spring(stiffness = Spring.StiffnessLow),
        label = "base",
    )
    val mic by animateFloatAsState(targetValue = level, animationSpec = tween(80), label = "mic")
    val color by animateColorAsState(
        targetValue = when (state) {
            OrbState.Idle -> Color(0xFF4F5B66)
            OrbState.Listening -> Color(0xFFE9F1F4)
            OrbState.Speaking -> Color(0xFF7FD1C8)
            OrbState.Working -> Color(0xFFE2B45A)
        },
        animationSpec = tween(250),
        label = "color",
    )
    Canvas(modifier) {
        val radius = size.minDimension / 2f
        val pulse = sin(phase * 2f * PI.toFloat())
        val scale = when (state) {
            OrbState.Listening -> base + 0.24f * mic
            OrbState.Speaking -> base + 0.06f * pulse
            else -> base
        }
        drawCircle(color = color, radius = radius * scale)
        if (state == OrbState.Working) {
            val stroke = 2.5.dp.toPx()
            drawArc(
                color = color.copy(alpha = 0.75f),
                startAngle = phase * 360f,
                sweepAngle = 100f,
                useCenter = false,
                topLeft = Offset(stroke, stroke),
                size = Size(size.width - 2 * stroke, size.height - 2 * stroke),
                style = Stroke(width = stroke, cap = StrokeCap.Round),
            )
        }
    }
}

/** Push to talk: press starts the turn, release ends it. */
@Composable
private fun TalkButton(active: Boolean, enabled: Boolean, onPress: () -> Unit, onRelease: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    val background = when {
        !enabled -> MaterialTheme.colors.surface
        active -> MaterialTheme.colors.primary
        else -> MaterialTheme.colors.primaryVariant
    }
    val foreground = if (enabled) MaterialTheme.colors.onPrimary else MaterialTheme.colors.onSurfaceVariant
    Box(
        modifier = Modifier
            .size(ButtonDefaults.DefaultButtonSize)
            .clip(CircleShape)
            .background(background)
            .pointerInput(enabled) {
                if (!enabled) return@pointerInput
                detectTapGestures(
                    onPress = {
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        onPress()
                        try {
                            tryAwaitRelease()
                        } finally {
                            onRelease()
                        }
                    },
                )
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(text = stringResource(R.string.talk), color = foreground, style = MaterialTheme.typography.button)
    }
}

@Composable
private fun StopButton(onStop: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    Button(
        onClick = {
            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            onStop()
        },
        colors = ButtonDefaults.secondaryButtonColors(),
    ) {
        Text(text = stringResource(R.string.stop), style = MaterialTheme.typography.button)
    }
}
