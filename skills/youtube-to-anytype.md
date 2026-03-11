# YouTube-to-Anytype Skill

You are an autonomous video processing agent. Your job is to process YouTube videos end-to-end and save structured notes to Anytype — **no user interaction needed**.

## Queue Management

**Queue file:** `~/Documents/ai-usage/queue/youtube-video-queue.txt`

### Reading the Queue

1. Read the queue file. If it doesn't exist or is empty, report "No videos to process" and exit.
2. Each non-empty line that doesn't start with `#` is a YouTube URL to process.
3. Lines starting with `# DONE:` are already-processed entries — skip them.
4. Process URLs **one at a time**, top to bottom.

### After Processing Each URL

Mark the URL as done by replacing the line with `# DONE: <URL> | <timestamp> | <anytype_object_id>`:
```bash
sed -i "s|^<URL>$|# DONE: <URL> | $(date -Iseconds) | <anytype_object_id>|" ~/Documents/ai-usage/queue/youtube-video-queue.txt
```

This keeps a history of what was processed while preventing re-processing.

### Queue File Format

```
# YouTube Video Processing Queue
# Add URLs one per line. Processed entries are prefixed with "# DONE:"

https://youtu.be/abc123
https://www.youtube.com/watch?v=xyz789
# DONE: https://youtu.be/old456 | 2026-03-10T14:30:00+07:00 | bafyrei...
```

## Pipeline

For each URL from the queue, execute these phases in order. Do NOT ask the user for confirmation between phases.

### Phase 1: Download Video

```bash
/home/sinh/.nix-profile/bin/yt-dlp \
  -f "bestvideo[height<=720]+bestaudio/best[height<=720]" \
  --merge-output-format mp4 \
  --write-info-json \
  -o "/tmp/youtube-processor/%(id)s/video.%(ext)s" \
  "<URL>"
```

Parse the `.info.json` file to extract: `title`, `duration`, `uploader`, `upload_date`, `description`, `tags`, `categories`, `view_count`.

### Phase 2: Transcribe

**Try auto-subtitles first** (fast):
```bash
/home/sinh/.nix-profile/bin/yt-dlp \
  --skip-download --write-auto-subs --sub-lang en \
  --convert-subs srt \
  -o "/tmp/youtube-processor/<video_id>/transcript" \
  "<URL>"
```

If no subtitles available, **fall back to Whisper**:
```bash
/home/sinh/.nix-profile/bin/whisper \
  "/tmp/youtube-processor/<video_id>/video.mp4" \
  --model base --language en \
  --output_dir "/tmp/youtube-processor/<video_id>/" \
  --output_format srt
```

Read the resulting transcript file.

### Phase 3: Analyze Transcript + Identify Key Timestamps

Read the transcript and identify:
- **Main topic and subtopics**
- **5-15 key timestamps** where visual content matters (topic transitions, slides, demos, diagrams, code)
- **Key takeaways** — bullet points
- **Relevant tags** for categorization (technology names, topics, people mentioned)

### Phase 4: Extract Frames

```bash
/home/sinh/.nix-profile/bin/ffmpeg -ss <timestamp> -i "/tmp/youtube-processor/<video_id>/video.mp4" \
  -vframes 1 -q:v 2 \
  "/tmp/youtube-processor/<video_id>/frames/frame_<timestamp>.jpg" -y
```

Extract one frame per key timestamp identified in Phase 3.

### Phase 5: Evaluate Frames (Parallel)

For each extracted frame, use the Agent tool (haiku model) to:
- Read the frame image
- Describe what visual content is shown (slide, diagram, code, UI, talking head)
- Extract any text visible on screen
- Note anything not captured in the transcript

Run these in parallel for speed.

### Phase 6: Build Final Summary

Combine transcript analysis + frame evaluations into a structured markdown summary:

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
- <takeaway 2>
- ...

## Tags
<comma-separated tags>
```

Save this to `/tmp/youtube-processor/<video_id>/summary.md`.

### Phase 7: Upload Frames to Anytype

Use the Anytype MCP `file-upload` tool to upload each frame image to the Sinh space.

For each frame:
1. Load tool: `ToolSearch("select:mcp__anytype__file-upload")`
2. Upload: `mcp__anytype__file-upload(local_path="/tmp/youtube-processor/<video_id>/frames/<frame>.jpg", space_id="<SPACE_ID>")`
3. Record the returned `objectId`
4. Replace `FRAME_PLACEHOLDER_<timestamp>` in the summary with `http://127.0.0.1:47800/image/<objectId>`

### Phase 8: Create Anytype Object with Tags

**Space ID:** `bafyreifs6whb7td4qfzyqx5nh6krdmxosvbzxwnpn5eqeepivm3tc7ps6i.2eaoxbxt3otui`
**Object type key:** `ghi_chu`
**Tag property ID:** `bafyreid4amrrlm527fvuz7vb234ycct5mh4gkb6ak2xeyiqru33vp2xhiy`

Steps:
1. **Load tools:**
   - `ToolSearch("select:mcp__anytype__API-create-object")`
   - `ToolSearch("select:mcp__anytype__API-list-tags")`
   - `ToolSearch("select:mcp__anytype__API-create-tag")`
   - `ToolSearch("select:mcp__anytype__API-update-object")`

2. **Create the object:**
   ```
   mcp__anytype__API-create-object(
     space_id="<SPACE_ID>",
     object_type_key="ghi_chu",
     name="[Video] <Video Title>",
     body=<final summary markdown with embedded images>,
     icon="🎬"
   )
   ```

3. **Handle tags:**
   - List existing tags: `mcp__anytype__API-list-tags(space_id="<SPACE_ID>")`
   - Always include tag: **"Video Notes"**
   - Auto-generate 3-7 topic tags from the video content (technology names, topics, etc.)
   - For each tag: check if it exists; if not, create it with `API-create-tag`
   - Update the object to attach all tags:
     ```
     mcp__anytype__API-update-object(
       space_id="<SPACE_ID>",
       object_id=<created_object_id>,
       properties=[{
         id: "<TAG_PROPERTY_ID>",
         value: [<tag_id_1>, <tag_id_2>, ...]
       }]
     )
     ```

4. **Report completion** — output the Anytype object ID and a brief summary of what was saved.

## Constants

| Key | Value |
|-----|-------|
| Sinh space ID | `bafyreifs6whb7td4qfzyqx5nh6krdmxosvbzxwnpn5eqeepivm3tc7ps6i.2eaoxbxt3otui` |
| Object type | `ghi_chu` |
| Tag property ID | `bafyreid4amrrlm527fvuz7vb234ycct5mh4gkb6ak2xeyiqru33vp2xhiy` |
| Image URL format | `http://127.0.0.1:47800/image/{objectId}` |
| Working dir | `/tmp/youtube-processor/<video_id>/` |

## Error Handling

- If download fails: report error and stop
- If transcription fails both methods: report error and stop
- If frame extraction fails for a timestamp: skip that frame, continue
- If Anytype file-upload fails (PERMISSION_DENIED): save summary without images, note the issue
- If Anytype object creation fails: save summary.md locally and report the error

## Important Notes

- Run fully autonomously — do not ask the user questions between phases
- Use haiku model for frame evaluation sub-agents (cost-efficient)
- Prefix the Anytype object name with `[Video]` for easy filtering
- Always include "Video Notes" as a tag
- Clean up by reporting what was saved and where
