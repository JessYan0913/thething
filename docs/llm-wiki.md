# LLM Wiki

A pattern for building personal knowledge bases using LLMs.

This is an idea file, designed to be copy-pasted to your own LLM Agent (such as OpenAI Codex, Claude Code, OpenCode / Pi, etc.). Its goal is to communicate the high-level idea, but your agent will build out the specifics in collaboration with you.

---

## The core idea

Most people's experience with LLMs and documents resembles RAG: upload files, retrieve chunks at query time, generate an answer. This works, but the LLM rediscovers knowledge from scratch every time. There is no accumulation. Ask a subtle question requiring synthesis of five documents, and the LLM must find and piece together fragments anew. NotebookLM, ChatGPT file uploads, and most RAG systems operate this way.

The idea here differs. Instead of retrieving from raw documents at query time, the LLM "incrementally builds and maintains a persistent wiki" — a structured, interlinked collection of markdown files sitting between you and raw sources. When a new source arrives, the LLM doesn't merely index it. It reads it, extracts key information, and integrates it into the existing wiki — updating entity pages, revising topic summaries, noting contradictions with older data, strengthening or challenging the evolving synthesis. The knowledge is compiled once and kept current rather than re-derived per query.

The key distinction: "the wiki is a persistent, compounding artifact." Cross-references are already present. Contradictions have been flagged. The synthesis reflects everything you've read. The wiki grows richer with each source added and each question asked.

"You never (or rarely) write the wiki yourself — the LLM writes and maintains all of it." You handle sourcing, exploration, and asking the right questions. The LLM handles summarizing, cross-referencing, filing, and bookkeeping. In practice, the author has the LLM agent on one side and Obsidian on the other. The LLM edits based on conversation while browsing results in real time — following links, checking graph view, reading updated pages. Obsidian serves as the IDE, the LLM as the programmer, and the wiki as the codebase.

This applies across many contexts. Examples include:

- **Personal**: tracking goals, health, psychology, self-improvement — filing journal entries, articles, podcast notes, building a structured self-picture over time.
- **Research**: going deep on a topic over weeks or months — reading papers, articles, reports, incrementally building a comprehensive wiki with an evolving thesis.
- **Reading a book**: filing each chapter, building pages for characters, themes, plot threads, and connections. By the end, a rich companion wiki exists. Think of fan wikis like Tolkien Gateway — thousands of interlinked pages built by volunteers over years. You could build something similar personally as you read, with the LLM handling cross-referencing and maintenance.
- **Business/team**: an internal wiki maintained by LLMs, fed by Slack threads, meeting transcripts, project documents, customer calls. Possibly with human review of updates. The wiki stays current because the LLM does the maintenance nobody wants to do.
- **Competitive analysis, due diligence, trip planning, course notes, hobby deep-dives** — anything involving accumulating knowledge over time that benefits from organization.

---

## Architecture

There are three layers:

**Raw sources** — your curated collection of source documents. Articles, papers, images, data files. These are immutable — the LLM reads from them but never modifies them. This is the source of truth.

**The wiki** — a directory of LLM-generated markdown files. Summaries, entity pages, concept pages, comparisons, an overview, a synthesis. The LLM owns this layer entirely. It creates pages, updates them when new sources arrive, maintains cross-references, and keeps everything consistent. You read it; the LLM writes it.

**The schema** — a document (e.g., CLAUDE.md for Claude Code or AGENTS.md for Codex) telling the LLM how the wiki is structured, what conventions exist, and what workflows to follow when ingesting sources, answering questions, or maintaining the wiki. This is the key configuration file making the LLM a disciplined wiki maintainer rather than a generic chatbot. You and the LLM co-evolve this over time.

---

## Operations

**Ingest.** You drop a new source into the raw collection and instruct the LLM to process it. An example flow: the LLM reads the source, discusses key takeaways, writes a summary page, updates the index, updates relevant entity and concept pages across the wiki, and appends an entry to the log. A single source might touch 10–15 wiki pages. The author prefers ingesting sources one at a time while staying involved — reading summaries, checking updates, guiding emphasis. Batch ingestion with less supervision is also possible. You develop the workflow fitting your style and document it in the schema for future sessions.

**Query.** You ask questions against the wiki. The LLM searches relevant pages, reads them, and synthesizes answers with citations. Answers can take different forms: a markdown page, comparison table, slide deck (Marp), chart (matplotlib), canvas, etc. The important insight: "good answers can be filed back into the wiki as new pages." A comparison you asked for, an analysis, a discovered connection — these are valuable and shouldn't vanish into chat history. This way explorations compound in the knowledge base just like ingested sources.

**Lint.** Periodically, ask the LLM to health-check the wiki. Look for: contradictions between pages, stale claims superseded by newer sources, orphan pages without inbound links, important concepts lacking their own page, missing cross-references, data gaps fillable with web search. The LLM is good at suggesting new questions to investigate and new sources to find. This keeps the wiki healthy as it grows.

---

## Indexing and logging

Two special files help the LLM (and you) navigate the growing wiki:

**index.md** is content-oriented. It catalogs everything in the wiki — each page listed with a link, one-line summary, and optionally metadata like date or source count. Organized by category (entities, concepts, sources, etc.). The LLM updates it on every ingest. When answering a query, the LLM reads the index first to find relevant pages, then drills in. This works surprisingly well at moderate scale (~100 sources, ~hundreds of pages) and avoids embedding-based RAG infrastructure.

**log.md** is chronological. It's an append-only record of what happened and when — ingests, queries, lint passes. A useful tip: if each entry starts with a consistent prefix (e.g., `## [2026-04-02] ingest | Article Title`), the log becomes parseable with unix tools — `grep "^## \[" log.md | tail -5` gives the last 5 entries. The log provides a timeline of the wiki's evolution and helps the LLM understand recent activity.

---

## Optional: CLI tools

At some point you may want small tools helping the LLM operate on the wiki more efficiently. A search engine over wiki pages is the most obvious — at small scale the index file suffices, but as the wiki grows you want proper search. qmd is a good option: a local search engine for markdown files with hybrid BM25/vector search and LLM re-ranking, all on-device. It has both a CLI (so the LLM can shell out) and an MCP server (for native tool use). You could also build something simpler — the LLM can help vibe-code a naive search script as needed.

---

## Tips and tricks

- **Obsidian Web Clipper** is a browser extension converting web articles to markdown. Useful for quickly getting sources into your raw collection.
- **Download images locally.** In Obsidian Settings → Files and links, set "Attachment folder path" to a fixed directory (e.g., `raw/assets/`). Then in Settings → Hotkeys, search for "Download" to find "Download attachments for current file" and bind it to a hotkey (e.g., Ctrl+Shift+D). After clipping an article, hit the hotkey and images download locally. This lets the LLM view and reference images directly instead of relying on breakable URLs. Note: LLMs can't natively read markdown with inline images in one pass — the workaround is having the LLM read text first, then view referenced images separately for additional context. Clunky but functional.
- **Obsidian's graph view** is the best way to see the wiki's shape — what's connected, which pages are hubs, which are orphans.
- **Marp** is a markdown-based slide deck format. Obsidian has a plugin for it. Useful for generating presentations directly from wiki content.
- **Dataview** is an Obsidian plugin running queries over page frontmatter. If your LLM adds YAML frontmatter to wiki pages (tags, dates, source counts), Dataview can generate dynamic tables and lists.
- The wiki is just a git repo of markdown files. You get version history, branching, and collaboration for free.

---

## Why this works

The tedious part of maintaining a knowledge base isn't reading or thinking — it's bookkeeping. Updating cross-references, keeping summaries current, noting when new data contradicts old claims, maintaining consistency across dozens of pages. Humans abandon wikis because maintenance burden grows faster than value. "LLMs don't get bored, don't forget to update a cross-reference, and can touch 15 files in one pass." The wiki stays maintained because maintenance cost is near zero.

The human's job is to curate sources, direct analysis, ask good questions, and think about meaning. The LLM's job is everything else.

The idea relates in spirit to Vannevar Bush's Memex (1945) — a personal, curated knowledge store with associative trails between documents. Bush's vision was closer to this than what the web became: private, actively curated, with connections between documents as valuable as the documents themselves. The part he couldn't solve was who does the maintenance. The LLM handles that.

---

## Note

This document is intentionally abstract. It describes the idea, not a specific implementation. The exact directory structure, schema conventions, page formats, and tooling depend on your domain, preferences, and LLM of choice. Everything mentioned is optional and modular — pick what's useful, ignore what isn't. For example: sources might be text-only so image handling isn't needed. The wiki might be small enough that the index file alone suffices. You might not care about slide decks. You might want completely different output formats. The right way to use this is to share it with your LLM agent and work together to instantiate a version fitting your needs. The document's only job is to communicate the pattern. Your LLM can figure out the rest.
