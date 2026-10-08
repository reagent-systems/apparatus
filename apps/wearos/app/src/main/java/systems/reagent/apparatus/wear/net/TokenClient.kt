package systems.reagent.apparatus.wear.net

import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONException
import org.json.JSONObject

/** `POST {serverOrigin}/token`: a short-life Live token plus the setup message to send verbatim. */
class TokenClient(private val client: OkHttpClient, private val serverOrigin: String) {

    class Token(
        val token: String,
        val model: String,
        val setup: JSONObject,
        val expiresAt: String?,
        val resumptionHandle: String?,
    )

    /** Throws [IOException] on a network or HTTP error and [JSONException] on a bad body. */
    suspend fun fetch(auth: String): Token = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("${serverOrigin.trimEnd('/')}/token")
            .header("Authorization", "Bearer $auth")
            .post("{}".toRequestBody(JSON))
            .build()
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IOException("token: HTTP ${response.code}")
            val json = JSONObject(body)
            Token(
                token = json.getString("token"),
                model = json.str("model").orEmpty(),
                setup = json.optJSONObject("setup") ?: JSONObject(),
                expiresAt = json.str("expires_at"),
                resumptionHandle = json.str("resumption_handle")?.takeIf { it.isNotEmpty() },
            )
        }
    }

    private companion object {
        val JSON = "application/json; charset=utf-8".toMediaType()
    }
}
