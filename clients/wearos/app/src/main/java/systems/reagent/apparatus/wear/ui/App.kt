package systems.reagent.apparatus.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.min
import systems.reagent.apparatus.wear.AppViewModel
import systems.reagent.apparatus.wear.R
import systems.reagent.apparatus.wear.UiState
import systems.reagent.apparatus.wear.ui.orb.ThinkingOrb

/** The orb's diameter as a share of the screen's shorter side. */
const val ORB_FRACTION = 0.8f

/** Another device holds the voice session. */
const val DIMMED_ALPHA = 0.35f

@Composable
fun App(viewModel: AppViewModel, staticFrame: Boolean, onToggleCall: () -> Unit) {
    val ui by viewModel.ui.collectAsState()
    Screen(ui, staticFrame, onToggleCall)
}

/**
 * The whole screen is the thinking orb on black, and nothing else. The screen is one toggle:
 * a tap anywhere starts the call or hangs up. For TalkBack it is the one element, "Agent", on
 * or off, as on every client, and a double tap toggles it.
 */
@Composable
fun Screen(ui: UiState, staticFrame: Boolean, onToggleCall: () -> Unit) {
    val render = orbRender(ui.state, ui.held, ui.live, reducedMotion = staticFrame)
    val label = stringResource(R.string.agent)
    val value = stringResource(if (ui.inCall) R.string.call_on else R.string.call_off)
    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .toggleable(
                value = ui.inCall,
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                role = Role.Switch,
                onValueChange = { onToggleCall() },
            )
            .semantics {
                contentDescription = label
                stateDescription = value
            },
        contentAlignment = Alignment.Center,
    ) {
        ThinkingOrb(
            animation = render.animation,
            speed = render.speed,
            paused = render.paused,
            staticFrame = staticFrame,
            modifier = Modifier
                .size(min(maxWidth, maxHeight) * ORB_FRACTION)
                .alpha(if (render.dimmed) DIMMED_ALPHA else 1f),
        )
    }
}
