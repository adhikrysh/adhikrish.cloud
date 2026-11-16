# agent squad

with several coding agents running in separate terminals, the useful question is which one needs me next. agent-squad is a go terminal dashboard that brings waiting Claude Code and Codex sessions to the top and lets me jump to their terminals.

## reading activity

the dashboard reads the agents' local transcript files without modifying their sessions. a file's modification time is a cheap first filter. the timestamp inside its newest readable event decides whether it is still active, so touching an old file during a backup does not make an old session look busy.

each scanner reads a transcript tail and interprets the latest meaningful events. Codex has explicit task-start and task-completion events. Claude Code needs more inference from assistant messages, tool calls, and elapsed time. pending tool calls are matched to their results so one completed call cannot hide another that is still waiting.

the [engine](internal/engine/engine.go) merges scanner results, sorts sessions by attention needed and activity time, and rings once when a session enters a state that needs attention.

## finding the terminal

transcripts identify the session's working directory. process inspection connects that directory to a running agent and terminal. ambiguous matches stay unmatched.

jumping first tries the tmux pane containing the process. on macOS it can also use terminal application automation. when a terminal cannot be matched, the dashboard keeps enough information visible for a manual switch.

## keeping polling cheap

transcripts are scanned every second by default. process membership changes less often, so the process list refreshes every five seconds. batching directory lookups avoids spawning a separate lookup for every process, and caching avoids repeating them on every poll.

the [scanners](internal/scan/) and [jump handlers](internal/jump/) have tests for transcript parsing, stale activity, process matching, and navigation. fixtures cover unfinished calls, parallel calls, and malformed transcript tails.

## limits

status is inferred from events. a silent tool call lasting more than 30 seconds can look like an approval prompt. transcript formats can change, and terminal navigation depends on the terminal and available process information. the dashboard makes those sessions easier to find; it does not control the agents' work.
