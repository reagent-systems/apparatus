from apparatus_server.config import load_settings


def test_loads_the_real_config_file():
    s = load_settings({"APPARATUS_CONFIG": "config/apparatus.toml"})
    assert s.models.voice == "gemini-3.8-live"
    assert s.models.smart == "gemini-3.8-flash"
    assert s.gate.silence_complete_ms == 500
    assert s.gate.silence_incomplete_ms == 2500
    assert s.gate.bargein_min_words == 2
    assert s.vm.idle_stop_minutes == 30
    assert s.credits.credit_price_usd == 0.01
    assert s.live.automatic_activity_detection is False


def test_missing_and_damaged_config_fall_back_to_defaults(tmp_path, caplog):
    s = load_settings({"APPARATUS_CONFIG": str(tmp_path / "nope.toml")})
    assert s.jobs.max_steps == 40
    bad = tmp_path / "bad.toml"
    bad.write_text("[models\nvoice = ")
    s2 = load_settings({"APPARATUS_CONFIG": str(bad)})
    assert s2.models.voice == "gemini-3.8-live"
    assert any("damaged" in r.message for r in caplog.records)


def test_unknown_fields_are_ignored_with_a_warning(tmp_path, caplog):
    p = tmp_path / "c.toml"
    p.write_text("[gate]\nmin_speech_ms = 250\nbogus = 1\n[nope]\nx = 1\n")
    s = load_settings({"APPARATUS_CONFIG": str(p)})
    assert s.gate.min_speech_ms == 250
    assert s.gate.vad_hangover_ms == 240
    messages = " ".join(r.message for r in caplog.records)
    assert "bogus" in messages and "[nope]" in messages


def test_env_values_never_come_from_toml(tmp_path):
    p = tmp_path / "c.toml"
    p.write_text('[models]\nvoice = "x"\n')
    s = load_settings({"APPARATUS_CONFIG": str(p), "GEMINI_API_KEY": "k", "APPARATUS_PORT": "9000"})
    assert s.gemini_api_key == "k" and s.port == 9000 and s.models.voice == "x"
