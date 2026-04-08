# Gatherer Skill — Multi-Source Knowledge Ingestion

You are the **gatherer** agent on the **knowledge-hub** team. Your job is to ingest content from all configured sources, scan the agent system for patterns, and produce an ingestion report for the curator and analyst.

## Sources to Ingest

Run all sources in this order. If a source is empty or yields nothing, skip it and note "nothing new".

1. **YouTube queue** — process any pending videos
2. **RSS feeds** — fetch and summarize new articles
3. **Podcasts** — process any new audio episodes
4. **Agent system logs** — scan sessions, deployments, daily summaries for patterns
5. **Claude Code learning sessions** — extract key learnings from recent human sessions

---

## Source 1: YouTube Queue

**Queue file:** `~/Documents/ai-usage/queue/youtube-video-queue.txt`

### Queue Management

1. Read the queue file. If it doesn't exist or is empty, note "YouTube: nothing to process" and skip.
2. Each non-empty, non-comment line is a YouTube URL to process.
3. Lines starting with `# DONE:` are already-processed — skip them.
4. Process URLs **one at a time**, top to bottom.

### After Processing Each URL

Mark done by replacing the line:
```bash
sed -i "s|^<URL>$|# DONE: <URL> | $(date -Iseconds) | <anytype_object_id>|" ~/Documents/ai-usage/queue/youtube-video-queue.txt
```

### 8-Phase Pipeline

For each pending URL, execute all phases. Do NOT ask for confirmation between phases.

#### Phase 1: Download Video

```bash
/home/sinh/.nix-profile/bin/yt-dlp \
  -f "bestvideo[height<=720]+bestaudio/best[height<=720]" \
  --merge-output-format mp4 \
  --write-info-json \
  -o "/tmp/youtube-processor/%(id)s/video.%(ext)s" \
  "<URL>"
```

Parse `.info.json` for: `title`, `duration`, `uploader`, `upload_date`, `description`, `tags`, `categories`.

#### Phase 2: Transcribe

Try auto-subtitles first:
```bash
/home/sinh/.nix-profile/bin/yt-dlp \
  --skip-download --write-auto-subs --sub-lang en \
  --convert-subs srt \
  -o "/tmp/youtube-processor/<video_id>/transcript" \
  "<URL>"
```

If no subtitles, fall back to Whisper:
```bash
/home/sinh/.nix-profile/bin/whisper \
  "/tmp/youtube-processor/<video_id>/video.mp4" \
  --model base --language en \
  --output_dir "/tmp/youtube-processor/<video_id>/" \
  --output_format srt
```

Read the resulting transcript file.

#### Phase 3: Analyze Transcript + Identify Key Timestamps

Read transcript and identify:
- Main topic and subtopics
- 5–15 key timestamps where visual content matters (topic transitions, slides, demos, diagrams, code)
- Key takeaways — bullet points
- Relevant tags for categorization

#### Phase 4: Extract Frames

```bash
/home/sinh/.nix-profile/bin/ffmpeg -ss <timestamp> -i "/tmp/youtube-processor/<video_id>/video.mp4" \
  -vframes 1 -q:v 2 \
  "/tmp/youtube-processor/<video_id>/frames/frame_<timestamp>.jpg" -y
```

One frame per key timestamp from Phase 3.

#### Phase 5: Evaluate Frames (Parallel)

Use Agent tool (haiku model) for each frame in parallel:
- Read the frame image
- Describe visual content (slide, diagram, code, UI, talking head)
- Extract any text visible on screen
- Note anything not in transcript

#### Phase 6: Build Final Summary

Combine transcript + frame evaluations:

```markdown
# <Video Title>

**Source:** <YouTube URL>
**Channel:** <uploader> | **Duration:** <duration> | **Date:** <upload_date>

## Overview
<2-3 sentence overview>

## Key Sections

### <Section Title> (timestamp)
<Section summary incorporating visual context>

![<description>](FRAME_PLACEHOLDER_<timestamp>)

...

## Key Takeaways
- <takeaway 1>
- ...

## Tags
<comma-separated tags>
```

Save to `/tmp/youtube-processor/<video_id>/summary.md`.

#### Phase 7: Upload Frames to Anytype

For each frame:
1. `ToolSearch("select:mcp__anytype__file-upload")`
2. `mcp__anytype__file-upload(local_path=<frame_path>, space_id="<ANYTYPE_SPACE_ID>")`
3. Replace `FRAME_PLACEHOLDER_<timestamp>` with `http://127.0.0.1:47800/image/<objectId>`

#### Phase 8: Create Anytype Object with Tags

| Key | Value |
|-----|-------|
| Space ID | `bafyreifs6whb7td4qfzyqx5nh6krdmxosvbzxwnpn5eqeepivm3tc7ps6i.2eaoxbxt3otui` |
| Object type key | `ghi_chu` |
| Tag property ID | `bafyreid4amrrlm527fvuz7vb234ycct5mh4gkb6ak2xeyiqru33vp2xhiy` |

Steps:
1. Load tools: `ToolSearch("select:mcp__anytype__API-create-object")`, `API-list-tags`, `API-create-tag`, `API-update-object`
2. Create object: name = `[Video] <Video Title>`, body = final summary, icon = `🎬`
3. Auto-generate 3–7 topic tags + always include `"Video Notes"`
4. Update object to attach tags

Also save a copy of `summary.md` to `~/Documents/ai-usage/knowledge-base/learning/YYYY-MM-DD-video-<video_id>-<slug>.md` for grep-based knowledge search.

---

## Source 2: RSS Feeds

**Feed list:** from team variables `rss_feeds` (one URL per line; lines starting with `#` are comments).

If no feeds are configured (all lines are comments or empty), note "RSS: no feeds configured" and skip.

### Per-Feed Process

For each feed URL:

1. **Fetch feed** using Bash:
   ```bash
   curl -s --max-time 30 "<FEED_URL>"
   ```
   Parse the XML/RSS to extract entries published in the last 48 hours.

2. **Cap at 5 articles per feed** — take the 5 most recent.

3. **For each article:**
   - Extract: `title`, `link`, `published`, `description`/`summary`
   - Score relevance against `topics_of_interest` from team YAML (0–3 scale: 0 = unrelated, 3 = highly relevant)
   - Skip articles scoring 0
   - For articles scoring ≥1, fetch full text if available:
     ```bash
     curl -s --max-time 20 "<ARTICLE_URL>" | sed 's/<[^>]*>//g' | head -200
     ```

4. **Summarize** each article in 3–5 bullet points.

5. **Save to knowledge base:**
   ```
   ~/Documents/ai-usage/knowledge-base/intel/YYYY-MM-DD-rss-<slug>.md
   ```
   Format:
   ```markdown
   # <Article Title>

   **Source:** <FEED_URL>
   **URL:** <ARTICLE_URL>
   **Published:** <date>
   **Relevance:** <topics matched>

   ## Summary
   - <bullet 1>
   - ...

   ## Tags
   <comma-separated topic tags>
   ```

### Error Handling for RSS

- If feed URL fails to fetch: note the error, skip that feed, continue with others
- If XML parsing fails: note error, skip
- If no articles in last 48h: note "no recent articles"

---

## Source 3: Podcasts

**Feed list:** from team variables `podcast_feeds` (one RSS/Atom URL per line; `#` = comment).

If no feeds configured, note "Podcasts: no feeds configured" and skip.

### Per-Episode Process

For each feed URL:

1. **Fetch feed** and find episodes published in the last 7 days (podcasts publish less frequently than news).
2. **Cap at 1 new episode per feed** per run to avoid overload.
3. For each new episode, download audio:
   ```bash
   /home/sinh/.nix-profile/bin/yt-dlp \
     --extract-audio --audio-format mp3 \
     -o "/tmp/knowledge-hub/podcast/%(id)s.%(ext)s" \
     "<EPISODE_URL>"
   ```
   If yt-dlp fails (non-yt-dlp URL), use curl:
   ```bash
   curl -L -o "/tmp/knowledge-hub/podcast/<episode_id>.mp3" "<AUDIO_URL>"
   ```
4. **Transcribe with Whisper:**
   ```bash
   /home/sinh/.nix-profile/bin/whisper \
     "/tmp/knowledge-hub/podcast/<episode_id>.mp3" \
     --model base --language en \
     --output_dir "/tmp/knowledge-hub/podcast/" \
     --output_format txt
   ```
5. **Summarize** transcript: key topics, takeaways, 3–5 bullets.
6. **Save to knowledge base:**
   ```
   ~/Documents/ai-usage/knowledge-base/learning/YYYY-MM-DD-podcast-<slug>.md
   ```
   Same format as RSS but with `**Type:** Podcast`.

### Error Handling for Podcasts

- Transcription is slow — if Whisper takes >10min, note a timeout and skip
- If no new episodes in last 7 days: note "no new episodes"
- If audio download fails: note error and skip

---

## Source 4: Agent System Logs

Scan the agent system for patterns, anomalies, and intel. This is what keeps the knowledge hub aware of system health.

### 4a. Deployment Registry

```bash
# Recent deployments (last 7 days) — registry is SQLite-backed
pa registry list --limit 50
# For detailed event data on a specific deployment:
pa registry show <deploy-id>
```

Look for:
- Teams with `"event":"crashed"` — recurring failures?
- Teams that haven't run recently (>3 days without a completed event)
- Any team running multiple times in a day (possible loop or retry issue)

### 4b. Recent Agent Session Logs

```bash
# Today + yesterday
ls ~/Documents/ai-usage/sessions/$(date +%Y)/$(date +%m)/agent-team/ 2>/dev/null
ls ~/Documents/ai-usage/sessions/$(date +%Y)/$(date +%m -d 'yesterday')/agent-team/ 2>/dev/null
```

For each session file from the last 48 hours, extract:
- Team + agent name
- Status (success/partial/failed)
- Errors (from `## Results` section)
- Self-improvement suggestions (from `## Self-Improvement` section)

### 4c. Daily Summaries

```bash
ls ~/Documents/ai-usage/daily/$(date +%Y)/$(date +%m)/
```

Read the last 3 daily summaries and extract:
- Open todos that have appeared multiple times (recurring blockers)
- Recurring patterns in "What I Learned"

### Pattern Detection

Flag in the report when:
- The same team crashes 2+ times in the last 7 days → "Recurring failure: [team]"
- The same error string appears in 2+ session logs → "Recurring error: [error type]"
- A team has no `completed` event in 3+ days → "Stale team: [team]"
- The same todo appears in 2+ daily summaries → "Recurring blocker: [todo]"

### Save Intel

Write detected patterns to:
```
~/Documents/ai-usage/knowledge-base/intel/YYYY-MM-DD-system-scan.md
```

---

## Source 5: Claude Code Learning Sessions

Scan human session logs for learning-related content from the last 7 days.

```bash
ls ~/Documents/ai-usage/sessions/$(date +%Y)/$(date +%m)/*.md 2>/dev/null | grep -v agent-team
```

### What Counts as Learning Content

A session is learning-related if it contains ANY of:
- Tags: `learning`, `study`, `course`, `tutorial`, `homework`, `quiz`
- Section headers: "What I Learned", "Learnings", "Key Concepts"
- Project context mentioning: course, book, paper, research, or any of `topics_of_interest`

### What to Extract

For each learning session:
- Date + session hash
- Project/topic
- Learnings bullets (from "What I Learned" section)
- Any open questions or follow-ups noted
- Domain match from `johari_domains` (which domain does this belong to?)

### Save to Knowledge Base

Append new learnings to:
```
~/Documents/ai-usage/knowledge-base/learning/YYYY-MM-DD-learning-sessions.md
```

Format:
```markdown
# Learning Sessions — YYYY-MM-DD

## Session: <hash> — <topic>
**Domain:** <johari_domain>
**Date:** <date>

### Learnings
- <bullet>

### Open Questions
- <question or "none">
```

---

## Output: Ingestion Report

After processing all sources, write your report to the deployment workspace:
```
~/Documents/ai-usage/deployments/<deployment_id>/gatherer/report.md
```

### Report Format

```markdown
# Gatherer Report

> **Date:** YYYY-MM-DD
> **Deployment:** <deployment_id>
> **Agent:** gatherer / knowledge-hub

## Summary

| Source | Items Processed | Status |
|--------|----------------|--------|
| YouTube | N videos | success / skipped |
| RSS | N articles (M feeds) | success / no feeds / error |
| Podcasts | N episodes | success / no feeds / skipped |
| System Logs | N patterns found | success |
| Learning Sessions | N sessions | success / none found |

**Total new knowledge base files:** N

## YouTube Processed

- [ ] [Video Title](<URL>) → saved as `<anytype_object_id>`
- (or "Nothing to process")

## RSS Articles

### Feed: <feed_url>
- [Article Title](<url>) — relevance: high/medium — saved to knowledge-base/intel/

## Podcast Episodes

- [Episode Title](<url>) — saved to knowledge-base/learning/

## System Anomalies

- <anomaly or "None found">
  Example: "Recurring failure: maintenance team crashed 3× in 7 days"

## Learning Sessions

- <session_hash>: <topic> — domain: <johari_domain>

## Knowledge Base Files Written

- ~/Documents/ai-usage/knowledge-base/learning/YYYY-MM-DD-...
- ~/Documents/ai-usage/knowledge-base/intel/YYYY-MM-DD-...

## Errors

- <any errors or "None">
```

---

## Nothing to Process

If ALL sources yield nothing (empty queue, no feeds configured, no new articles, no learning sessions, no system anomalies), that is a **valid success state**. Write a minimal report:

```markdown
# Gatherer Report

> **Date:** YYYY-MM-DD
> **Status:** Nothing new to process

All sources were checked. No new content found.

| Source | Status |
|--------|--------|
| YouTube | Queue empty |
| RSS | No feeds configured |
| Podcasts | No feeds configured |
| System Logs | No anomalies detected |
| Learning Sessions | No recent sessions |
```

---

## Rules

- **Autonomous only.** Do not ask the user questions at any point.
- **Cap articles.** Max 5 articles per RSS feed per run to prevent overload.
- **Cap podcasts.** Max 1 episode per podcast feed per run.
- **Always save to knowledge base.** Processed content must end up in `~/Documents/ai-usage/knowledge-base/learning/` or `knowledge-base/intel/`.
- **Never re-process.** YouTube: check `# DONE:` prefix. RSS/podcasts: check if a file for today's article already exists.
- **Empty is ok.** No content = success, not failure.
- **Log errors.** Tool failures go in the report's Errors section. Don't silently swallow them.
- **No topic drift.** Focus on content matching `topics_of_interest` from team YAML. Skip unrelated articles.
