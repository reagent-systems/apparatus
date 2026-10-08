package systems.reagent.apparatus.wear

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.mutableStateOf
import androidx.core.content.ContextCompat
import androidx.wear.ambient.AmbientLifecycleObserver
import systems.reagent.apparatus.wear.ui.App

class MainActivity : ComponentActivity() {

    private val viewModel: AppViewModel by viewModels()

    /** The watch's low-power always-on display. The orb shows the library's static frame there. */
    private val ambient = mutableStateOf(false)

    /** Settings > Accessibility > Remove animations: the platform's reduced motion. */
    private val reducedMotion = mutableStateOf(false)

    private val ambientObserver = AmbientLifecycleObserver(
        this,
        object : AmbientLifecycleObserver.AmbientLifecycleCallback {
            override fun onEnterAmbient(ambientDetails: AmbientLifecycleObserver.AmbientDetails) {
                ambient.value = true
            }

            override fun onExitAmbient() {
                ambient.value = false
            }
        },
    )

    /**
     * Nothing is asked at launch: the first screen is the orb alone. A tap without the microphone
     * permission asks for it, and for notifications (approvals) with it; the call starts once the
     * microphone is granted.
     */
    private val permissionsForCall = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        if (result[Manifest.permission.RECORD_AUDIO] == true) viewModel.startCall()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lifecycle.addObserver(ambientObserver)
        setContent {
            App(viewModel, staticFrame = ambient.value || reducedMotion.value, onToggleCall = ::toggleCall)
        }
        viewModel.connect()
    }

    override fun onResume() {
        super.onResume()
        reducedMotion.value = Settings.Global.getFloat(contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }

    private fun toggleCall() {
        if (!viewModel.ui.value.inCall && !granted(Manifest.permission.RECORD_AUDIO)) {
            val wanted = buildList {
                add(Manifest.permission.RECORD_AUDIO)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
            }
            permissionsForCall.launch(wanted.filterNot(::granted).toTypedArray())
            return
        }
        viewModel.toggleCall()
    }

    private fun granted(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
}
