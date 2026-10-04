import pytest

from apparatus_server.store import FileStore, MemoryStore, make_store


@pytest.mark.parametrize("kind", ["memory", "file"])
async def test_store_round_trip(kind, tmp_path):
    store = make_store(kind, str(tmp_path))
    assert await store.get("c", "k") is None
    await store.put("c", "k", {"a": 1})
    assert await store.get("c", "k") == {"a": 1}
    await store.put("c", "k2", {"a": 2})
    assert sorted(d["a"] for d in await store.list("c")) == [1, 2]
    await store.delete("c", "k")
    assert await store.get("c", "k") is None
    await store.append("log", "u", {"n": 1})
    await store.append("log", "u", {"n": 2})
    assert [e["n"] for e in await store.entries("log", "u")] == [1, 2]


async def test_memory_store_returns_copies():
    s = MemoryStore()
    await s.put("c", "k", {"a": [1]})
    doc = await s.get("c", "k")
    doc["a"].append(2)
    assert await s.get("c", "k") == {"a": [1]}


async def test_file_store_rejects_path_tricks(tmp_path):
    s = FileStore(tmp_path)
    with pytest.raises(ValueError):
        await s.get("../x", "k")
    with pytest.raises(ValueError):
        await s.put("c", "../../etc", {})


def test_unknown_store():
    with pytest.raises(ValueError):
        make_store("redis", "x")
