---
title: "Fifteen agents attacked my MCP endpoint before its first commit"
subtitle: "Hardening a read-only vault MCP server with a multi-agent adversarial review: 12 confirmed findings, all fixed pre-commit"
author: Dylan Palumbo
date: 2026-07-16
tags: [mcp, security, adversarial-review, multi-agent, fastapi, code-review]
draft: true
---

<!--
evidence (staging note, all claims sourced from wiki/handoffs/2026-07-11-fleet-audit-execution.md
§2026-07-15 continuation + §Tranche 2 backlog, and wiki/projects/idea-capture.md):
shipped 2026-07-15; new /mcp-vault Streamable-HTTP mount; single bearer token; three read-only
tools (vault_semantic_search, read_wiki_page, list_dir); dormant until its token is set
(behavior-neutral for the running bot); own TransportSecuritySettings because the adjacent
facade's loopback-only settings 421 non-loopback Hosts; 15-agent adversarial review, 12 confirmed
findings, all fixed before commit (OSError path-leak, raw-exception passthrough, hidden-dotfile
reads, "."/"./" whitelist bypass, SDK-marks-schema-required, websocket hang, non-ASCII-auth 500);
20 new tests incl. a real HTTP tools/call round-trip; suite 1,362 green. Precedent: 2026-07-09
adversarial review of the idea service caught an unlocked write race (os.replace resurrecting a
just-moved file into a permanent duplicate-id 500) pre-deploy, proven by a concurrent race test.
-->

**Source:** the production repo is private; the platform it mounts onto is public in outline as [Domo](https://github.com/Aquinas-Protocol/domo), the MIT extraction of my agent stack.

I wanted Claude Desktop to be able to read my personal knowledge vault: semantic search over the wiki, page reads, directory listings, served over my private network. The build was small on purpose. A Streamable-HTTP MCP mount on the FastAPI process that already serves my agent dashboard, gated by a single bearer token, exposing exactly three tools: `vault_semantic_search`, `read_wiki_page`, and `list_dir`. Read-only end to end, and dormant by default: if its token is not configured, the mount does not exist, so the change is behavior-neutral for the running system until deliberately switched on.

An afternoon of code, in other words. Which is exactly the kind of change that ships with confident bugs. So before the first commit, I pointed a fifteen-agent adversarial review at it. Twelve findings were confirmed, and all twelve were fixed before the code was ever committed.

## "Read-only" is not "harmless"

The lazy risk model says a read-only endpoint can't hurt you. The actual exposure:

- **Reads are the prize.** The vault is a personal knowledge base. A path-resolution bug in a read-only tool is not a low-severity nuisance; it is the entire attack.
- **Errors leak.** Exception text is a side channel. An unhandled `OSError` will happily print absolute filesystem paths into a tool result.
- **The process is shared.** The mount lives inside the same process that runs my agent fleet. A request that hangs a handler is a denial-of-service against everything else in that process.
- **Auth edges are input too.** Anything the client controls, including the `Authorization` header itself, is attack surface.

## The panel

The review ran as fifteen independent agents in parallel against the same small diff. The claimed findings were then verified against the actual code before they counted. **Twelve findings survived verification.**

That verification step matters as much as the fan-out. Review agents are fuzzers, not oracles: they generate plausible accusations cheaply, and some of those accusations are wrong. Confirm-then-count keeps the process honest and keeps you from "fixing" phantoms.

## What they caught

The confirmed findings clustered into three classes.

**Information leaks.** An `OSError` passed through raw would leak absolute filesystem paths into tool results, and other exceptions passed through unwrapped did the same for internals. Both now map to sanitized errors.

**Access-boundary gaps.** Hidden dotfiles were readable through the page-read path even though listings hid them, and the directory whitelist could be bypassed with `.` and `./` path spellings that satisfied the check while escaping its intent. Both closed.

**Protocol and transport edges.** A WebSocket upgrade request against the mount would hang instead of failing fast. A non-ASCII byte in the auth header produced a 500 instead of a clean 401. And an SDK quirk marks every schema field as required, which silently breaks optional parameters for strict clients. Each fixed or explicitly worked around.

One more gotcha was already known from an earlier audit pass, and it is exactly the kind a lone reviewer skims past: the adjacent, existing MCP mount's transport-security settings are deliberately loopback-only, and reusing them would have rejected every legitimate private-network request with an HTTP 421. The new mount got its own allowed-hosts configuration instead of inheriting a neighbor's assumptions.

## Why a panel beats one reviewer

- **Decorrelated attention.** A single reviewer satisfices: after two or three good catches, the mental "this code is fine" bit flips. Fifteen narrow briefs do not share that bit. The dotfile read and the `./` bypass are precisely the pair a satisfied generalist merges past, because each looks like the other one already covered it.
- **Attackers don't share your mental model.** The bug you cannot see is the one your own model of the code excludes. Many independent models of "how this breaks" approximate a real adversary better than one careful pass by the author, who is the person least able to see their own assumptions.
- **Breadth finally costs minutes, not days.** Agent reviewers run in parallel. The expensive resource (human attention) is spent only on verified findings and their fixes, at the moment fixes are cheapest: before the first commit, while the diff is still small and nothing depends on it.
- **It has a track record here.** An earlier adversarial review of a small write service in the same fleet caught an unlocked write race before deploy: two concurrent requests could resurrect a just-archived file into a permanent duplicate-id failure. The fix was proven with a concurrent race test. This is a pattern, not a one-off.

## What shipped

The endpoint landed with twenty new tests, including a real HTTP `tools/call` round-trip against the mount, and the full suite green at 1,362. It ships dormant, wakes only when its token is configured, and exposes nothing beyond the three read-only tools.

## Limits

An adversarial panel does not prove the absence of bugs; it raises the price of shipping obvious ones. The confirmed-findings count is a function of the briefs you hand out, and a blind spot shared by all fifteen agents stays blind. The primary control is still the smallest one — three read-only tools, one token, off by default, reachable only on a private network. The review hardens the walls. Keeping the room small is what makes the walls defensible.
