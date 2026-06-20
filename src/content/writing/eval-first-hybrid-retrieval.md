---
title: "I built hybrid retrieval, then let the eval decide what to ship"
subtitle: "Dense vs hybrid over a synthetic corpus, gated by a keyless eval, deployed free — and what the eval revealed about the verdict"
author: Dylan Palumbo
date: 2026-06-20
tags: [rag, retrieval, evaluation, hybrid-search, qdrant, postgres, reciprocal-rank-fusion]
draft: false
---

**Source:** [github.com/Aquinas-Protocol/vault-rag-eval](https://github.com/Aquinas-Protocol/vault-rag-eval) · **Live demo:** [arti0-vault-rag-eval.hf.space](https://arti0-vault-rag-eval.hf.space) · the cloud-deployed sibling of [email-triage-ts](https://github.com/Aquinas-Protocol/email-triage-ts).

*A small, honest study: dense vs. hybrid retrieval over a synthetic corpus, gated by a keyless eval, deployed to a real cloud container. The interesting part isn't the score — it's what the eval revealed about the score.*

## Start with the method, not the number

Any retrieval write-up that opens with a metric is asking you to trust a number
whose provenance you can't see. So first, the method.

The benchmark is a **reviewed gold set**: 48 natural-language queries, each labeled
with the corpus page(s) that genuinely answer it. The queries were authored *from
the documents' content* — not from any search output, so the labels don't
pre-bake what the system already retrieves — and then adversarially reviewed on two
axes: label correctness (is the labeled page unambiguously the right answer?) and
anti-rigging (does a "paraphrase" query avoid echoing the document's title, so it
genuinely tests semantic matching rather than keyword overlap?). The mix is
deliberately paraphrase-heavy — 32 paraphrase, 8 exact-identifier, 8 multi-page —
and that choice is disclosed because it matters to the result.

The gate is **keyless**. Embeddings are content-addressed and committed, so CI runs
the real retrieval path with no model and no API key; a missing fixture is a hard
error, and any metric below baseline fails the build. The point is that the eval
measures *what production does*, reproducibly, for free — the same discipline I
shipped in [email-triage-ts](https://github.com/Aquinas-Protocol/email-triage-ts),
applied to retrieval instead of classification.

## The hypothesis

Dense embeddings blur exact tokens — names, error codes, flags, identifiers. A
knowledge base is full of those. So the hypothesis was that a **lexical arm**
(exact-token + substring matching) fused with the dense arm via Reciprocal Rank
Fusion would lift recall where dense is weakest. I built it: dense over Qdrant,
lexical over Postgres full-text + `pg_trgm`, fused app-side.

## The data

Scored over the 48 queries, broken down by query kind:

| query kind | n | dense hit@5 | dense mrr@10 | hybrid-exact mrr@10 |
|---|---|---|---|---|
| paraphrase | 32 | **1.000** | 0.953 | 0.984 |
| exact-identifier | 8 | 0.875 | 0.812 | 0.893 |
| multi-page | 8 | 1.000 | 1.000 | 1.000 |

And the config sweep (overall):

| config | hit@5 | recall@10 | mrr@10 |
|---|---|---|---|
| dense | 0.979 | 0.979 | 0.938 |
| hybrid-exact | 0.979 | **1.000** | 0.972 |
| hybrid-exact+trigram | **1.000** | 1.000 | 0.974 |
| hybrid-tuned (exact, dense ×3) | 0.979 | 1.000 | 0.971 |

Two things jump out. **Dense is already perfect on conceptual queries** (hit@5
1.000) — semantic matching is exactly its strength. And the lexical arm's *entire*
contribution is on the 8 exact-identifier queries. The canonical case: a query for
the invented identifier `FENCING_EPOCH_ID` returns nothing useful from dense — the
top three are unrelated pages — because a brand-new token has no meaningful vector.
Exact matching finds it instantly.

So on this corpus's mix, hybrid edges ahead. But look at *why*: the aggregate lift
is small (one query on hit@5), within noise at n=48, and comes entirely from
identifier queries. The original hypothesis was right about *where* lexical helps
and wrong about *how much it matters here*.

## The vignette: the eval caught a config I'd have shipped blind

`hybrid-exact+trigram` has the best headline number — hit@5 = 1.000, a clean sweep.
If I'd picked on the headline, I'd have shipped it. But the by-kind breakdown shows
trigram *raises hit@k while lowering mrr on exactly the queries it's supposed to
help*: on identifier queries its mrr@10 drops to 0.844, below plain `hybrid-exact`'s
0.893. Trigram surfaces the right page but also drags in substring-noise that
reorders the top results. That's a worse ranking masquerading as a better score —
precisely the kind of plausible-but-wrong config an eval exists to catch.

## What I shipped, and when the verdict flips

**Dense, by default.** On this corpus the honest lift from hybrid is small and
localized; dense alone is near-perfect on the conceptual queries that dominate, and
it needs only the vector store at query time. The lexical arm stays in the code,
documented and tested, enabled per-corpus.

The verdict flips on the **query mix**, and that's the real finding. A
paraphrase-heavy gold set concludes "dense wins." A gold set that stresses exact
identifiers — which a real engineering knowledge base is full of — concludes
"hybrid earns its keep." Same code, opposite call. **A hybrid-vs-dense result is
only as representative as the gold set's query distribution**, and most "we use
hybrid RAG" claims never say what theirs was. If your users search for error codes
and flag names, turn the lexical arm on; if they ask conceptual questions, it's
dead weight. The eval is what lets you make that call with numbers instead of
folklore.

## Cost: HF Spaces vs Fly vs Fargate (2026-06, us-east)

The live demo runs at **https://arti0-vault-rag-eval.hf.space** for **$0**: a single
free Hugging Face Docker Space runs the real `qdrant/qdrant` server next to the
FastAPI app, with managed Neon Postgres as the lexical arm. The trade for free is
ephemeral storage (Qdrant re-seeds its 120 vectors from the committed fixtures on
each boot — sub-second) and idle sleep (a ~30s cold start on the first visit). For
a public portfolio demo that's the right trade; the proof doesn't depend on the URL
being warm (the behavior is also recorded in the repo).

For a workload that actually serves traffic, the topology I'd reach for is the one
in `deploy/`: a private Qdrant container + a scale-to-zero FastAPI app on Fly.io,
plus Neon. Idle there is about **$0.30–0.75/mo**, dominated by the 1 GB Qdrant
volume (~$0.15/GB-month, billed even while the machine is stopped; snapshots off,
they became billable Jan 2026). The AWS-native equivalent — ECS Fargate, EFS for
Qdrant storage, an ALB to reach it, a NAT gateway for a private subnet — runs
roughly **$40–70/mo always-on**, and the surprise is that the *compute* is the
cheap part: the ALB (~$16/mo) and the NAT gateway (~$32/mo) are the floor, and a
stateful vector DB doesn't scale-to-zero cleanly behind them.

None of that is a verdict on a platform; it's a verdict on the *workload*. **HF
Spaces** wins for a zero-cost public demo that tolerates cold starts. **Fly** wins
for a low-traffic always-reachable service on a tight budget. **Fargate** wins the
moment you need VPC-private data paths, org-standard ECS/IaC, or you already run an
ALB and NAT — then one more task is marginal and the integration is the point.
Naming when your own choice flips is the difference between a cost comparison and a
cost rationalization.

## What this does NOT defend against

This is the section that should make you trust the rest more, not less.

- **The corpus is synthetic** — 40 neutral documents. The numbers characterize the
  *method* (and the deployment), not a universal "dense beats hybrid" claim.
- **n=48 ranks configs; it does not bound confidence intervals.** Treat
  single-query deltas as noise. I did not compute CIs and won't pretend to.
- **Retrieval only.** This measures whether the right *page* is retrieved, not
  whether a downstream model answers faithfully from it.
- **One embedding model, 768 dims.** A different model would reorder the margins;
  the model + dim are pinned to the collection identity for that reason.
- **Paraphrase-heavy by construction.** That choice favors dense and is the single
  biggest lever on the headline. An identifier-heavy gold set would flip it — which
  is the whole point of the "verdict depends on the mix" finding.
- **Postgres `ts_rank_cd` is full-text ranking, not BM25.** No IDF, TF-saturation,
  or length normalization. And the parser splits identifiers on underscores, so the
  exact-identifier recall actually comes from the `pg_trgm` substring arm, not the
  `tsvector` arms. I label it accordingly rather than borrowing BM25's credibility.

The repo, this writeup, the architecture diagram, the recorded deploy, and the
metrics table carry the whole story — the live URL is a disposable bonus. If it's
down when you read this, you haven't missed anything.
