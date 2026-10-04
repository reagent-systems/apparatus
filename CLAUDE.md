# apparatus — start here

This repository runs on the agent kit. Read `agent-kit/ROUTING.md` first; it says which
file governs which situation. `agent-kit/AGENTS.md` is the binding contract for any code
change. `agent-kit/TONE.md` governs your own words. There is exactly one contract: this
file only points to it.

Quick facts:

- Health gate: `verify/verify.sh`. Green before every push.
- Protocol: `agent-kit/docs/PROTOCOL.md` ↔ `protocol/apparatus_protocol/__init__.py`. Change both in one commit.
- Config: `config/apparatus.toml` ↔ `agent-kit/docs/CONFIGURATION.md`. Change both in one commit.
- What to build next: `agent-kit/ROADMAP.md`. Where things stand: `agent-kit/STATUS.md`.
