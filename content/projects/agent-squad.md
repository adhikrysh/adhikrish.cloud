# agent-squad

Live terminal dashboard for every Claude Code and Codex session on your
machine. Sessions that need you float to the top; press Enter to jump to
the terminal running them.

```
agent-squad — 3 sessions

  STATE    AGENT   PROJECT          LAST ACTIVITY
■ WAITING  codex   fraud-service    Awaiting approval (1m)
■ DONE     claude  dialer           Waiting on input (4m)
■ RUNNING  claude  otp-workflow     Running Bash (12s)

2 need attention · refreshed 1s ago
```

## Run it

```sh
go install github.com/adhikrysh/agent-squad@latest
agent-squad
```

Or from a clone:

```sh
git clone https://github.com/adhikrysh/agent-squad
cd agent-squad
go build -o agent-squad . && ./agent-squad
```

**Ghostty + bash?** Run this once so jumping can match terminals by
working directory (idempotent; prints exactly what it touches):

```sh
agent-squad setup
```

Without it, jumps to Claude Code sessions still work via tab-title
matching; Codex sessions need it (or tmux).

## Use

| Flag | Default | Meaning |
|---|---|---|
| `--interval` | `1s` | poll interval |
| `--stale` | `30m` | hide sessions quiet longer than this |
| `--no-bell` | off | disable bell when a session starts needing you |

Keys: `↑/↓` or `j/k` select · `Enter`/click jump · `q` quit.

States: ■ orange WAITING (approval prompt) · ■ green DONE (your turn) ·
■ red RUNNING · ■ gray IDLE. The bell rings once when a session enters
WAITING or DONE.

Read-only, always: agent-squad never writes to `~/.claude` or `~/.codex`,
and never modifies a session.

## How it works, in detail

### 1. Finding sessions

Neither CLI exposes a status API, but both append every event to a
transcript file as it happens — one JSON object per line:

- Claude Code: `~/.claude/projects/<flattened-path>/<session-uuid>.jsonl`
- Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`

Every file has an mtime, a modification timestamp the kernel updates on
each write, readable with a `stat` call in microseconds without opening
the file. Discovery uses mtime as a cheap first-pass filter, then reads the
embedded timestamp of the newest transcript event. That second check is
authoritative: backup, migration, and sync tools can touch an old file
without adding agent activity. Sessions whose newest event is older than
the 30-minute window stay hidden.

#### Why file modification time is not session activity

A transcript has two clocks:

- **Event time** is written inside each JSON record by Claude Code or Codex.
  It answers: "When did this agent last do something?"
- **File modification time (`mtime`)** is maintained by the filesystem.
  It answers: "When did any program last touch this file?"

Those clocks normally move together because appending an event also modifies
the file. They can separate when a backup, migration, indexer, restore, or sync
operation touches an old transcript without appending an event. For example:

```text
Last transcript event: July 30, 22:46
Filesystem mtime:      August 3, 11:00
Actual agent activity: none since July 30
```

If agent-squad treated `mtime` as activity, it would resurrect that July 30
session for another 30 minutes. The scanner therefore uses `mtime` only to
find candidate files cheaply. After opening a candidate, it uses the newest
embedded event timestamp for both state classification and the stale-session
cutoff:

```text
mtime -> cheap candidate filter -> newest event timestamp -> show or hide
```

The model is `recent agent event -> active session`, not
`recently modified file -> active session`. If a changed transcript format has
no readable event timestamp, agent-squad falls back to `mtime` rather than
crashing.

### 2. Classifying state

The agent never reports its state; agent-squad infers it from what got
written last and how long ago according to the event's embedded timestamp.
It reads only the final 64 KB of each candidate transcript and parses
backwards to the last meaningful record.

Claude Code:

| Last record on disk | Age | State |
|---|---|---|
| tool call with no result yet | under 30 s | RUNNING — tool executing |
| tool call with no result yet | 30 s or more | WAITING — a live tool would have produced output by now; this is almost always a permission prompt |
| completed assistant turn | newest event 10 s+ old | DONE — your move |
| completed assistant turn | newest event under 10 s old | RUNNING — likely mid-turn, more records coming |
| user message or tool result | under 2 min | RUNNING — model is thinking |
| anything | quiet 2 min+ | IDLE |

Codex writes explicit brackets — `task_started` … `task_complete` — so
DONE is read directly. Inside a bracket, a tool call whose output record
hasn't appeared for 30 s means WAITING; calls are matched to outputs by
call id so a finished call can't mask a stuck one.

The 30-second threshold exists because a permission prompt and a slow
tool call are byte-identical on disk at first. Time is the only
discriminator, which is why classification is inherently a heuristic.

### 3. Matching sessions to terminals

Transcripts say what's happening; jumping needs where. The bridge is the
working directory: a transcript records its session's cwd, and the kernel
knows each process's cwd. Every 5 seconds agent-squad runs `ps` to list
claude/codex processes, resolves each new pid's cwd, and matches it
against session cwds. Exactly one session and one process in a directory
→ that row gets a pid and tty. Any ambiguity → no match, never a guess.

Jumping tries, in order:

1. **tmux** — walk the process ancestry to the pane, `switch-client` +
   `select-window`. Fully reliable.
2. **AppleScript** (macOS) — Ghostty 1.3+ by working directory, falling
   back to tab title for Claude Code sessions (titles live in both the
   transcript and the tab); iTerm2 and Terminal.app by tty. Apps that
   aren't running are never launched (`pgrep` guard first).
3. **Fallback** — the row shows project + tty for a manual switch.

### 4. Why polling every second is cheap

Reading transcript tails costs ~3 ms per poll. The expensive part was
process matching, and three standard techniques removed it:

- **Batching.** Reading another process's cwd on macOS means spawning
  `lsof`, and spawning costs ~40 ms per invocation regardless of the
  question. Ten processes were ten spawns (~400 ms); `lsof -p 501,502,…`
  asks all ten questions in one spawn.
- **Caching.** A process's cwd is fixed at launch (these CLIs never call
  `chdir`), so pid → cwd is remembered until the pid dies. Steady state:
  zero lsof spawns. Entries are evicted when a pid disappears, so a
  recycled pid gets re-resolved instead of served a stale path.
- **Rate matching.** `ps` itself costs ~70 ms, but process membership
  changes over seconds-to-minutes, not milliseconds. It runs every 5 s
  while transcripts are scanned every 1 s — poll each signal at the rate
  it actually changes.

Net effect: 420 ms per poll down to ~7 ms, under 1% of one core at the
default 1-second interval.

### Known limits

- State is inferred from transcript events, so it approximates: a
  long-running silent tool call looks like a permission prompt after
  30 s.
- Each transcript file is one row. Claude Code helper/subagent sessions
  write their own transcripts, so they appear as extra sessions.
- Transcript formats belong to the CLIs and can drift; unknown formats
  degrade to mtime-only status rather than crashing.
