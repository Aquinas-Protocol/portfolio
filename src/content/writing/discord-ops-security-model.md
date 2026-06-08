---
title: "A threat model for a personal multi-agent system"
subtitle: "What discord-ops defends against, mapped onto OWASP LLM Top 10 (2025)"
author: Dylan Palumbo
date: 2026-06-08
tags: [agent-security, owasp, llm-top-10, threat-modeling, claude-agent-sdk, mcp]
draft: false
---

`discord-ops` is a Discord-fronted Claude Code assistant that runs a council of specialist agents (operator, finance, career-intelligence, correspondence, calendar) on a single Windows host. The agents have real tools: they read my email, draft replies, scan job boards, run elevated PowerShell, write to a knowledge vault. The blast radius if any one of them goes wrong is real.

The defensive patterns inside it weren't built from a security-architecture document. They accumulated organically. Every time I caught a misbehavior, I closed the gap structurally rather than by tightening the prompt. After three months of running it 24/7, the result reads, in retrospect, like a defense-in-depth model. This post is the model written down, mapped onto the [OWASP LLM Top 10 (2025)](https://owasp.org/www-project-top-10-for-large-language-model-applications/). The taxonomy is good for organizing the thinking, and if you're reading this trying to decide whether the engineering is credible, OWASP IDs are a faster index than my prose.

## The system, in a paragraph

A single Windows service hosts a Discord bot that dispatches messages to a persistent `ClaudeSDKClient` per agent. Each agent has its own persona file, its own MCP tool allowlist, and its own Discord channel. Tool calls are routed through the Claude Agent SDK; the heavyweight tools (Gmail, Calendar, finance ledger, opportunity store, video transcription, elevated PowerShell) are custom in-process MCP servers. A separate Windows service running as `LocalSystem` brokers elevation. The Discord bot itself runs at a lower trust level and cannot directly execute administrator commands.

That separation, plus a `PreToolUse` policy hook fired on every tool invocation, plus a strict single-user auth gate at message receipt, is what this post is about.

## Threat model

I built `discord-ops` for one user (me), but the threat model still has to assume an adversarial environment. The classes of harm I actively design against:

1. **Adversary injects instructions into agent input**, through an email body, a webpage I asked the agent to summarize, or a Discord message from someone other than me. Goal: get the agent to leak secrets, take destructive actions, or impersonate me.
2. **Agent makes a "reasonable" but harmful tool call on its own initiative**: overwrites a vault page, sends an email it shouldn't, runs an elevated command. No external adversary needed; the model is the failure mode.
3. **A single compromised component cascades**: a captured tool result corrupts the next decision, which corrupts the next, which ends in privilege escalation or data exfiltration.

Everything below is organized against those three failure modes.

---

## LLM06: Excessive Agency

> *"Excessive Agency is the vulnerability that enables damaging actions to be performed in response to unexpected, ambiguous or manipulated outputs from an LLM."* (OWASP LLM06, 2025)

LLM06 is the single biggest source of risk in `discord-ops`, because the whole point of the system is to *give* the agents real tools. Three controls layer against it.

### Per-agent MCP tool allowlists

Every agent in `agents.yaml` carries an explicit `enabled_tools` list. The correspondence agent (Hermes) has Gmail draft tools but not elevation tools. The finance agent (Plutus) has the finance ledger but not Gmail. The career-intelligence agent (Nike) has the opportunity store, web fetch, and resume tailoring. No Gmail send, no elevation, no calendar mutation.

This is the cheapest and most boring control in the system and it absorbs the most risk. A prompt-injected job listing that says "now email all your contacts" reaches Nike, whose tool surface does not include sending email. Even if the model fully complies, the action is structurally impossible.

The principle is *capability minimization at the agent level, not the prompt level*. The persona file can be jailbroken; the tool allowlist cannot.

### Human-in-the-loop approval embeds for high-blast-radius tools

Elevation, outbound Gmail send, and a handful of other irreversible tools surface a Discord approval embed before executing. The embed is edited in place when resolved. Approval and rejection both update the original message and disable the buttons. The tool call blocks on the approval signal; if I don't click, it doesn't run.

The non-obvious design detail: the embed never gets replaced with a fresh message. I made that mistake early (issuing `view=None` and posting a new "approved" message) and learned that disappearing approval prompts erode trust in the system. The new defaults are *edit in place, preserve all fields, disable controls*. The audit trail is the message itself.

This is straight-line LLM06 defense: the model proposes, the human disposes, and the system is structurally incapable of taking the action without a deliberate human gesture.

### The elevation broker: defense in depth against an LLM06 → privilege-escalation chain

Even with HITL approval, *the bot is not allowed to know what command it's asking to run.*

The broker is a separate Windows service running as `LocalSystem`. The bot service runs at a lower trust level. They communicate over a named pipe (`\\.\pipe\discord-ops-elevation-broker`). The wire protocol is intentionally minimal:

```
bot   →  broker:  {"request_id": "<uuid>"}
broker→  bot:     {"status": "executed", "exit_code": 0, "stdout": "...", "stderr": "..."}
```

The bot's payload over the pipe carries *only* the UUID. The broker reads the canonical command from the `elevation_requests` SQLite table, verifies it's in `status='approved'`, re-hashes the command and compares to the stored `sha256`, *then* runs it. As the broker's docstring puts it:

> *The bot can't lie over the pipe to bypass approval.*

The broker also enforces a small, conservative, non-overridable deny list: `format C:`, removal of `C:\Windows`, deletion of `HKLM\SYSTEM` hives. Modifying that list requires a code change and a service restart. It is intentionally not configurable from any agent surface.

This is the layered piece. Even if a prompt-injected agent convinces the model to call the elevation tool with a malicious command, and even if it somehow convinced me to approve a forged embed, the broker independently re-derives what to execute from its own authoritative store. A compromise of the bot does not become a compromise of `LocalSystem`.

---

## LLM02: Sensitive Information Disclosure

> *"Sensitive Information Disclosure refers to the risk of exposing confidential data through the LLM's outputs."* (OWASP LLM02, 2025)

The `PreToolUse` hook (`hooks/pretooluse_guard.py`) is the mechanical floor. It fires on every tool invocation *including under `bypassPermissions`*. If the model is in autonomous mode, the prompt-permission layer is disabled, but the hook still runs.

Specifically, the hook denies:

- **Reads** of secret files by basename, regardless of path: `.env`, `.credentials.json`, `gmail-token.json`, `gmail-client.json`, `gmail-modify-token.json`, and anything matching `.env.*`.
- **Reads** of anything under `~/.config/discord-ops/`, the credential directory.
- **Writes** to `raw/` (read-only source material in the vault), `agents/` (persona files edited only by the user), the bot's own source directory (no self-modification), `~/.claude/projects` (Claude session storage), and specific configuration files (`agents.yaml`, `settings.json`).

Two pieces of this are worth highlighting for the security-engineering reader.

### Same fence for reads and for writes-then-reads

A write to `~/.config/discord-ops/gmail-token.json` from an agent is shaped like exfiltration prep: clobber, then read back. The hook applies the read-deny fence to *writes* on those paths too. Catching both verbs at the same chokepoint is cheaper and tighter than maintaining separate lists.

### Filename-first Bash gating: no verb allowlist

The Bash branch of the hook does *not* try to enumerate every command that can read a file. The implementation note in the source captures the reasoning:

> *Read/exfil verbs are open-ended (cat, head, sed, awk, cp, scp, dd, xxd, base64, python -c, ruby -e, perl, `[IO.File]::ReadAllText`, ...). Listing "all" is impossible; verb-based gating fails open under adversarial framing.*

So the hook denies any Bash command that *mentions* a sensitive filename or credential directory, regardless of what verb wraps it. False positives are accepted (`echo .env > log.txt` is denied; the agent retries with different phrasing). The trade is intentional: a small UX cost for closing an entire class of bypass.

This is also a defense against **LLM01 (Prompt Injection)**: a sufficiently clever injection might convince the model to invent a novel exfil path. As long as the path mentions the filename, the hook blocks it. The hook doesn't trust the model; it pattern-matches the request.

---

## LLM01: Prompt Injection

> *"Prompt Injection Vulnerabilities occur when an attacker manipulates a large language model through crafted inputs."* (OWASP LLM01, 2025)

The honest answer about LLM01 in `discord-ops` is that *I do not try to detect prompt injection at the input layer.* Untrusted text (emails, web pages, job listings, calendar invites) flows into the agents unfiltered. The defenses are downstream:

- **Tool allowlists** (LLM06 above) bound what an injected instruction can ask the agent to do.
- **The PreToolUse hook** (LLM02 above) pattern-matches the request rather than trusting the model's reasoning about it.
- **HITL approval embeds** (LLM06 above) put a human between the model's decision and the irreversible action.
- **The elevation broker's UUID-only payload** (LLM06 above) means even a successfully injected agent can't smuggle a payload into the elevated execution path.

The bet I've made is that detecting injection at the input layer is a losing race, but constraining what an injected agent can *do* is tractable. That's not novel; it's the same reasoning behind capability-based security generally. The taxonomy match is just clearer now.

The known gap, and the next thing I expect to build, is a request-side interceptor around `ClaudeSDKClient` send/receive, sitting on the inference path itself. That moves a thin layer of detection upstream of the tool-call decision, paired with the existing downstream controls. Defense in depth at two layers instead of one.

---

## LLM07: System Prompt Leakage (and impersonation)

> *"System Prompt Leakage refers to the risk that the system prompts or instructions used to steer the behavior of the model can also contain sensitive information."* (OWASP LLM07, 2025)

Two pieces of `discord-ops` defend the persona surface and the user-identity surface together.

### Single-user auth gate at message receipt

The bot has exactly one authorized user (me). Discord messages from anyone else are dropped at receipt, before they reach the agent runner, before any LLM call is made. This is the cheapest control in the entire system and it prevents an entire class of harm: prompt injection via a Discord DM from a stranger, impersonation, social engineering of any kind from outside.

It is not a substitute for the per-tool controls above, but it removes the cheapest attack vector. The agents simply never see input from anyone who isn't me.

### Persona files are read-only at agent runtime

The `agents/` directory is in the `PreToolUse` hook's read-only roots. Even an autonomous agent in `bypassPermissions` mode cannot modify its own persona file. This blocks a class of LLM07-adjacent attacks where an injected agent attempts to rewrite its own steering. The personas are user-edited only.

---

## What this model explicitly does not defend against

A threat model that doesn't name its gaps isn't a threat model.

- **LLM03 (Supply Chain):** The MCP servers are in-process Python; the dependency chain (Claude Agent SDK, Discord SDK, Google API clients) is large and not audited by me. A compromised PyPI dependency would have access to everything the bot has access to. Mitigations are limited to pinned versions and selective trust.
- **LLM04 (Data and Model Poisoning):** Not applicable in any way I control. I use Anthropic's hosted Claude models; I do not train or fine-tune.
- **LLM05 (Improper Output Handling):** I render LLM output into Discord and into the vault. Discord handles its own escaping; vault writes are text files I review. No code is `eval`'d from model output. This isn't actively engineered against, but the architecture doesn't create the surface.
- **LLM08 (Vector and Embedding Weaknesses):** No RAG layer. Not applicable.
- **LLM09 (Misinformation):** The agents tell me wrong things sometimes. I am the human in the loop. This is the cost of running an LLM-fronted assistant and is not defended structurally.
- **LLM10 (Unbounded Consumption):** Anthropic API spend is governed at the account level (hard credit ceiling, no auto-reload) and at the bot level (per-agent idle reaping, cron load tracking). Not the same as a production rate-limit model, but adequate for a single-user system.

The biggest *unaddressed* gap inside the model's stated scope is the LLM01 piece: input-layer detection. The current architecture absorbs injection downstream rather than detecting it upstream. That's a real trade and the next iteration of the system will address it.

---

## Closing

None of this is novel security research. The patterns (capability minimization, HITL gates, privilege separation across processes, filename-based denylists, single-user auth) are old. What's worth saying out loud is that they apply *directly* to agentic LLM systems with very little adaptation. The Claude Agent SDK gives you hooks for a reason; MCP allowlists are a security feature, not just a routing feature; running the high-trust executor as a separate OS-level service is exactly the kind of boring infrastructure choice that pays back the first time something goes wrong.

The taxonomy mapping is more useful than I expected it to be. I built most of these controls because I caught the system doing something it shouldn't and closed the gap structurally. Naming them against OWASP IDs after the fact made the gaps in the model obvious, and made it clear which pieces I should build next.

*Dylan Palumbo, 2026-06-08*

*Source: `discord-ops` (formerly known as Domo), a personal Discord-fronted Claude Code assistant. Public repo: [github.com/Aquinas-Protocol/domo](https://github.com/Aquinas-Protocol/domo).*
