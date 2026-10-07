# command-journal

this c++ experiment asks what a ground-side command executor should do when it dies between sending a command and recording its result. the simulated payload is a register from 0 to 1023, so the persistence protocol stays visible.

a command is a compare-and-set operation. it has a sequence number, the sequence and value it expects to find, and the value it wants to write. those preconditions turn an old or duplicated command into a detectable conflict instead of a silent state change.

## the durable boundary

the host first appends an **accepted** record to its own journal and calls `fsync`. only then may it dispatch the command to the payload. the payload checks the same precondition, appends the exact command to its own durable log, syncs it, and only then acknowledges it. after the acknowledgement, the host appends and syncs a **completed** record.

```text
host              payload
 | accept + sync     |
 v                   |
commands log         |
 | dispatch -------->|
 |                   v
 |              apply + sync
 |<------ durable ack|
 v
complete + sync
```

that ordering prevents the dangerous gap where a payload changes state but the host has no durable record that it ever asked. recovery is finite: one command may be pending, and the payload may be only one durable command ahead.

the key case is a lost acknowledgement. command 2 changes the register from 42 to 84, the payload syncs it, and the process exits before the host records completion. on restart, both histories are replayed before either file changes. the payload already stores the same sequence and command body, so recovery writes only the missing host completion. it does **not** send command 2 again.

if the payload has not stored the accepted command, recovery checks the expected sequence and value before applying it. if either check fails, it stops rather than guessing. reusing a sequence number with different command content is also an error. these rules prevent an old command or a split-brain history from being mistaken for a safe retry.

## validating the journal

each frame has a magic and version, bounded length, typed payload, and crc32c checksum. accepted frames carry the full command; completion frames carry the sequence they close. replay checks state transitions as well as bytes: sequence order, expected state, one pending command, and matching completion.

the scanner distinguishes an incomplete final tail from corruption. after both journals validate, a writable open truncates only the incomplete tail and syncs the repaired files and directory. a read-only open only reports it. a complete frame with a bad checksum, length, kind, or transition is rejected. the scanner never searches for a later magic marker, because skipping damaged bytes could also skip a real command.

this is why recovery verifies **both** logs before repair. truncating one log first could destroy the evidence needed to decide whether the payload already acted. the same conservatism applies after an I/O failure: the executor becomes poisoned and rejects further calls. close it, reopen it, replay the durable histories, and recover from what actually reached disk.

## concurrency and containment

the executor takes a non-blocking exclusive write lock and a shared inspection lock. it opens logs with `O_NOFOLLOW`, requires regular files, retries interrupted I/O, and caps each journal at 64 mib. these checks prevent competing writers, symlink redirects, shortened I/O, and unbounded replay memory.

the payload log proves an effect; the host log preserves intent and completion. neither side infers the other from a transient acknowledgement or process memory.

## verification

the test executable has five checks. it verifies the crc32c known-answer value, every prefix of a two-frame stream, and 464 one-bit corruptions. it rejects malformed transitions and symlinked logs, checks stale preconditions and the single-writer lock, and proves that an executor poisoned by an I/O-boundary failure must be reopened.

the central recovery test starts fresh processes and deliberately exits at all nine write and sync boundaries: acceptance, payload application, and host completion. it runs recovery twice and confirms that the final history is stable and the payload application count does not increase on the second pass.

requires C++20, CMake 3.20+, and a POSIX system. you can reproduce the lost-acknowledgement case:

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel 3
ctest --test-dir build --output-on-failure

journal_demo_dir=$(mktemp -d)
./build/command-journal set "$journal_demo_dir" 0 42
./build/command-journal set "$journal_demo_dir" 42 84 --crash payload_sync || test "$?" -eq 75
./build/command-journal status "$journal_demo_dir"
./build/command-journal recover "$journal_demo_dir"
```

the crash exits 75. before recovery, the host is at sequence 1 while the payload is at sequence 2; after recovery, both are at sequence 2 with value 84 and two payload applications total.

this demonstrates exactly-once *recovery* only because the simulated payload durably remembers command ids and command contents. it does not establish exactly-once control for a physical actuator that can lose that memory, act after power loss without recording the result, or have its own write cache lie about durability. the tests exercise process death, not sudden power removal or failed storage hardware. compaction is also absent, so the 64 mib journals are a bounded experiment rather than a long-running flight design.

the [executor api](include/journal/executor.hpp), [record format](docs/format.md), and [tests](tests/test_journal.cpp) describe the implementation at this project revision. JPL's [F Prime command sequencer](https://fprime.jpl.nasa.gov/v4.3.0/Svc/CmdSequencer/docs/sdd/) is useful context for command validation and sequencing; this project is a separate persistence experiment.
