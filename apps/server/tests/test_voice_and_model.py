import json
from types import SimpleNamespace

from apparatus_server.model import FakeSmartModel, ModelReply, parse_response
from apparatus_server.smart import first_user_message, smart_tool_declarations
from apparatus_server.voice import live_connect_config, live_setup_message, voice_tool_declarations


def test_voice_tools_are_all_non_blocking():
    decls = voice_tool_declarations()
    assert {d["name"] for d in decls} == {"start_job", "check_job", "cancel_job", "show"}
    assert all(d["behavior"] == "NON_BLOCKING" for d in decls)


def test_live_setup_turns_off_automatic_activity_detection(settings):
    setup = live_setup_message(settings, "gemini-3.8-live", "earlier summary", "handle-1")["setup"]
    assert setup["model"] == "models/gemini-3.8-live"
    assert setup["realtimeInputConfig"] == {"automaticActivityDetection": {"disabled": True}}
    assert setup["sessionResumption"] == {"handle": "handle-1"}
    assert setup["contextWindowCompression"] == {"slidingWindow": {}}
    assert setup["generationConfig"]["responseModalities"] == ["AUDIO"]
    assert "earlier summary" in setup["systemInstruction"]["parts"][0]["text"]
    decls = setup["tools"][0]["functionDeclarations"]
    assert decls[0]["behavior"] == "NON_BLOCKING"
    assert "start_job" in json.dumps(decls)
    # The whole thing is JSON-serialisable for the wire.
    json.dumps(setup)


def test_live_connect_config_matches_sdk_field_names(settings):
    cfg = live_connect_config(settings, None, None)
    assert cfg["realtime_input_config"]["automatic_activity_detection"]["disabled"] is True
    assert cfg["session_resumption"] == {}
    assert cfg["tools"][0]["function_declarations"][0]["name"] == "start_job"
    from google.genai import types

    types.LiveConnectConfig.model_validate(cfg)  # the SDK accepts it


def test_smart_tools_and_first_message():
    names = [d["name"] for d in smart_tool_declarations()]
    assert names == ["python", "computer", "show", "handoff"]
    text = first_user_message("get the csv", "model=pro", "- note a", "- tool b", "t1")
    assert "Job: get the csv" in text
    assert "<<<EXTERNAL_DATA source=memory_index" in text
    assert "/home/agent/tasks/t1/" in text


def test_parse_response_reads_calls_text_and_usage():
    part_call = SimpleNamespace(
        thought=False,
        function_call=SimpleNamespace(id="c1", name="python", args={"code": "1"}),
        text=None,
    )
    part_text = SimpleNamespace(thought=False, function_call=None, text="hello")
    part_thought = SimpleNamespace(thought=True, function_call=None, text="secret")
    response = SimpleNamespace(
        candidates=[
            SimpleNamespace(content=SimpleNamespace(parts=[part_thought, part_text, part_call]))
        ],
        usage_metadata=SimpleNamespace(
            prompt_token_count=100,
            candidates_token_count=20,
            thoughts_token_count=5,
            cached_content_token_count=60,
        ),
    )
    r = parse_response(response)
    assert r.text == "hello"
    assert r.calls[0].name == "python" and r.calls[0].args == {"code": "1"}
    assert (r.usage.input_tokens, r.usage.output_tokens, r.usage.cached_tokens) == (100, 25, 60)
    content = r.as_content()
    assert content["role"] == "model" and content["parts"][1]["function_call"]["name"] == "python"


async def test_fake_model_runs_out_gracefully():
    m = FakeSmartModel([ModelReply(text="a")])
    assert (await m.generate(model="x", system="", history=[], tools=[])).text == "a"
    assert "failed" in (await m.generate(model="x", system="", history=[], tools=[])).text
