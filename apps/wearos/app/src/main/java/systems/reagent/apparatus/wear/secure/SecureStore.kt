package systems.reagent.apparatus.wear.secure

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Small secrets, encrypted with a key in the Android Keystore (design spec, Security rule 9).
 *
 * One instance per process: [of]. When the keystore is unavailable, reads return the default
 * and writes are dropped; the app then runs with the "dev" auth value and no queue.
 */
class SecureStore private constructor(context: Context) {

    private val prefs: SharedPreferences? = try {
        val masterKey = MasterKey.Builder(context, MasterKey.DEFAULT_MASTER_KEY_ALIAS)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    } catch (e: Exception) {
        // GeneralSecurityException, IOException or a keystore runtime failure: no persistence.
        Log.w(TAG, "keystore unavailable: ${e.message}")
        null
    }

    fun get(key: String): String? = prefs?.getString(key, null)

    fun get(key: String, default: String): String = get(key) ?: default

    fun set(key: String, value: String) {
        prefs?.edit()?.putString(key, value)?.apply()
    }

    fun delete(key: String) {
        prefs?.edit()?.remove(key)?.apply()
    }

    companion object {
        private const val TAG = "SecureStore"
        private const val FILE = "apparatus.secure"

        /** The bearer value for `/token` and `/ws/client`. The dev server accepts a user id. */
        const val KEY_AUTH = "auth"
        const val DEFAULT_AUTH = "dev"

        /** JSON array of `approval.answer` messages given while no socket was open. */
        const val KEY_PENDING_APPROVALS = "pending_approvals"

        @Volatile private var instance: SecureStore? = null

        fun of(context: Context): SecureStore =
            instance ?: synchronized(this) {
                instance ?: SecureStore(context.applicationContext).also { instance = it }
            }
    }
}
