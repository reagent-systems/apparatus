import asyncio

import pytest

from agentd import disk
from agentd.kernel import Kernel


@pytest.fixture
async def kernel(cfg):
    disk.ensure_layout(cfg.home)
    tdir = disk.task_dir(cfg.home, "t1")
    tdir.mkdir(parents=True)
    k = Kernel(
        "t1",
        tdir,
        tools_dir=disk.tools_dir(cfg.home),
        socket_path=cfg.socket_path,
        home=cfg.home,
        max_output_chars=300,
    )
    await k.start()
    yield k
    await k.kill()


async def test_variables_persist_between_calls(kernel):
    r1 = await kernel.execute("x = 21\nprint('set')", 5)
    assert r1.ok and r1.output.strip() == "set"
    r2 = await kernel.execute("x * 2", 5)
    assert r2.ok and r2.output.strip() == "42"


async def test_shell_output_and_stderr_are_captured(kernel):
    r = await kernel.execute(
        "import subprocess, sys\nsubprocess.run('echo from-shell', shell=True)\nprint('err', file=sys.stderr)",
        5,
    )
    assert r.ok
    assert "from-shell" in r.output
    assert "err" in r.output


async def test_exception_returns_error_not_crash(kernel):
    r = await kernel.execute("1/0", 5)
    assert not r.ok
    assert "ZeroDivisionError" in r.error
    assert "kernel_child.py" not in r.error
    assert kernel.alive
    r2 = await kernel.execute("print('still here')", 5)
    assert r2.ok and "still here" in r2.output


async def test_timeout_kills_the_kernel(kernel):
    r = await kernel.execute("import time\ntime.sleep(5)", 0.5)
    assert not r.ok and r.killed
    assert "TimeoutError" in r.error
    assert not kernel.alive


async def test_blocked_flag_pauses_the_clock(kernel):
    async def unblock_later():
        await asyncio.sleep(0.6)
        kernel.blocked = False

    kernel.blocked = True
    asyncio.ensure_future(unblock_later())
    # Runs 0.8 s with a 0.5 s limit, but 0.6 s of it is "blocked" time.
    r = await kernel.execute("import time\ntime.sleep(0.8)\nprint('ok')", 0.5)
    assert r.ok, r.error


async def test_new_files_are_listed_and_output_is_truncated(kernel, cfg):
    r = await kernel.execute("open('report.csv','w').write('a,b\\n')\nprint('x' * 1000)", 5)
    assert r.ok
    assert any(f.endswith("report.csv") for f in r.files)
    assert "characters cut" in r.output
    assert len(r.output) < 1000


async def test_saved_tools_are_importable(kernel, cfg):
    (disk.tools_dir(cfg.home) / "greet.py").write_text("def hi(n):\n    return f'hi {n}'\n")
    r = await kernel.execute("import greet\nprint(greet.hi('tool'))", 5)
    assert r.ok and "hi tool" in r.output


async def test_user_code_cannot_read_the_protocol_channel(kernel):
    r = await kernel.execute("import sys\nprint(repr(sys.stdin.read()))", 5)
    assert r.ok and r.output.strip() == "''"
