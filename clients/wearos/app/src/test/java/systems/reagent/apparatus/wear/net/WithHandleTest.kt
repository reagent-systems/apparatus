package systems.reagent.apparatus.wear.net

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Test

/** The `setup` message from `POST /token` is `{"setup": {...}}` and goes out verbatim (web `withHandle`). */
class WithHandleTest {

    private fun setup(resumption: JSONObject? = null): JSONObject {
        val inner = JSONObject().put("model", "models/m")
        if (resumption != null) inner.put("sessionResumption", resumption)
        return JSONObject().put("setup", inner)
    }

    @Test
    fun noHandleSendsTheSetupUnchanged() {
        val s = setup()
        assertSame(s, withHandle(s, null))
    }

    @Test
    fun theHandleGoesInsideSetup() {
        val out = withHandle(setup(JSONObject()), "h1")
        assertEquals("h1", out.getJSONObject("setup").getJSONObject("sessionResumption").getString("handle"))
        assertFalse(out.has("sessionResumption"))
        assertEquals("models/m", out.getJSONObject("setup").getString("model"))
    }

    @Test
    fun aHandleFromTheServerWins() {
        val out = withHandle(setup(JSONObject().put("handle", "server")), "local")
        assertEquals("server", out.getJSONObject("setup").getJSONObject("sessionResumption").getString("handle"))
    }

    @Test
    fun theInputIsNotModified() {
        val s = setup()
        withHandle(s, "h1")
        assertFalse(s.getJSONObject("setup").has("sessionResumption"))
    }
}
