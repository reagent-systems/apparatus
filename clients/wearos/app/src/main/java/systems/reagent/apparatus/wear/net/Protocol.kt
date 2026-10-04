package systems.reagent.apparatus.wear.net

import org.json.JSONObject

// Client <-> session server message types. Mirror of agent-kit/docs/PROTOCOL.md
// (C2S and S2C tables). Change both in one commit.

object C2S {
    const val HELLO = "hello"
    const val VOICE_CLAIM = "voice.claim"
    const val VOICE_RELEASE = "voice.release"
    const val TRANSCRIPT = "transcript"
    const val TOOL_CALL = "tool.call"
    const val HANDOFF_DONE = "handoff.done"
    const val HANDOFF_CANCEL = "handoff.cancel"
    const val APPROVAL_ANSWER = "approval.answer"
    const val LIVE_USAGE = "live.usage"
    const val LIVE_RESUMPTION = "live.resumption"
    const val LIVE_CLOSED = "live.closed"
    const val SIGNAL = "signal"
    const val PUSH_REGISTER = "push.register"
    const val PING = "ping"
}

object S2C {
    const val READY = "ready"
    const val VOICE_GRANTED = "voice.granted"
    const val VOICE_REVOKED = "voice.revoked"
    const val TRANSCRIPT = "transcript"
    const val JOB_STARTED = "job.started"
    const val JOB_PROGRESS = "job.progress"
    const val JOB_DONE = "job.done"
    const val SHOW = "show"
    const val HANDOFF_REQUESTED = "handoff.requested"
    const val HANDOFF_ENDED = "handoff.ended"
    const val APPROVAL_REQUESTED = "approval.requested"
    const val APPROVAL_ENDED = "approval.ended"
    const val TOOL_RESULT = "tool.result"
    const val CREDITS = "credits"
    const val SIGNAL = "signal"
    const val ERROR = "error"
    const val PONG = "pong"
}

const val DEVICE = "watch"

/** Builders for outbound C2S messages. */
object Messages {
    fun hello(wantsVoice: Boolean = true): JSONObject =
        of(C2S.HELLO).put("device", DEVICE).put("wants_voice", wantsVoice)

    fun voiceClaim(): JSONObject = of(C2S.VOICE_CLAIM)

    fun voiceRelease(): JSONObject = of(C2S.VOICE_RELEASE)

    fun transcript(role: String, text: String, final: Boolean): JSONObject =
        of(C2S.TRANSCRIPT).put("role", role).put("text", text).put("final", final)

    fun toolCall(callId: String, name: String, args: JSONObject): JSONObject =
        of(C2S.TOOL_CALL).put("call_id", callId).put("name", name).put("args", args)

    fun approvalAnswer(approvalId: String, approved: Boolean): JSONObject =
        of(C2S.APPROVAL_ANSWER).put("approval_id", approvalId).put("approved", approved)

    fun liveUsage(audioInMs: Long, audioOutMs: Long, inputTokens: Int, outputTokens: Int): JSONObject =
        of(C2S.LIVE_USAGE)
            .put("audio_in_ms", audioInMs)
            .put("audio_out_ms", audioOutMs)
            .put("input_tokens", inputTokens)
            .put("output_tokens", outputTokens)

    fun liveResumption(handle: String): JSONObject = of(C2S.LIVE_RESUMPTION).put("handle", handle)

    fun liveClosed(reason: String): JSONObject = of(C2S.LIVE_CLOSED).put("reason", reason)

    fun pushRegister(token: String): JSONObject =
        of(C2S.PUSH_REGISTER).put("platform", "fcm").put("token", token)

    fun ping(): JSONObject = of(C2S.PING)

    private fun of(type: String): JSONObject = JSONObject().put("type", type)
}

/**
 * The string under [name], or null when the field is missing, JSON null or not a string.
 * `JSONObject.optString` returns the text "null" for a JSON null, which is never what we want.
 */
fun JSONObject.str(name: String): String? {
    if (!has(name) || isNull(name)) return null
    return opt(name) as? String
}

/** Converts the server origin to its WebSocket form: http -> ws, https -> wss. */
fun toWsOrigin(origin: String): String {
    val trimmed = origin.trimEnd('/')
    return when {
        trimmed.startsWith("https://") -> "wss://" + trimmed.removePrefix("https://")
        trimmed.startsWith("http://") -> "ws://" + trimmed.removePrefix("http://")
        else -> trimmed
    }
}
