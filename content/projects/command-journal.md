# command-journal

if ground software crashes right after sending a command, it comes back up not knowing whether the payload ran it. resend and it might run twice. don't, and it might never run. command-journal is an experiment in recovering from that cleanly: crash at any of the nine points where it writes to disk, and recovery works out what happened and runs every command exactly once.

## how it works

the payload is a simulated register that holds a number from 0 to 1023. every command says "if the value is X, set it to Y", so it only applies when the payload is in the state the sender expected.

both sides keep a journal on disk, and each step is written and synced (`fsync`) before the next one starts:

<figure class="diagram">
<svg viewBox="0 0 640 295" role="img" aria-label="sequence: host accepts and syncs, dispatches, payload applies and syncs, acks, host completes and syncs">
<defs><marker id="cj-a1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<rect class="d-box" x="80" y="10" width="140" height="50" rx="4"/><text class="d-t" x="150.0" y="32" text-anchor="middle">host</text><text class="d-s" x="150.0" y="49" text-anchor="middle">its journal</text>
<rect class="d-box" x="420" y="10" width="140" height="50" rx="4"/><text class="d-t" x="490.0" y="32" text-anchor="middle">payload</text><text class="d-s" x="490.0" y="49" text-anchor="middle">its journal</text>
<line class="d-line d-dash" x1="150" y1="60" x2="150" y2="285"/><line class="d-line d-dash" x1="490" y1="60" x2="490" y2="285"/>
<rect class="d-store" x="90" y="80" width="120" height="30" rx="4"/><text class="d-s" x="150.0" y="100.0" text-anchor="middle">1  accept + sync</text>
<line class="d-line" x1="150" y1="140" x2="488" y2="140" marker-end="url(#cj-a1)"/><text class="d-s" x="320" y="133" text-anchor="middle">2  dispatch</text>
<rect class="d-store" x="430" y="160" width="120" height="30" rx="4"/><text class="d-s" x="490.0" y="180.0" text-anchor="middle">3  apply + sync</text>
<line class="d-line" x1="490" y1="225" x2="152" y2="225" marker-end="url(#cj-a1)"/><text class="d-s" x="320" y="218" text-anchor="middle">4  ack</text>
<rect class="d-store" x="90" y="245" width="120" height="30" rx="4"/><text class="d-s" x="150.0" y="265.0" text-anchor="middle">5  complete + sync</text>
</svg>
<figcaption>the protocol, one step at a time. each box is a journal write that is synced to disk before the next step starts.</figcaption>
</figure>

that order means at most one command is ever in doubt, and the payload is never more than one command ahead of the host.

say the payload changed 42 to 84 and the process died before the host recorded "completed". recovery reads both journals, finds that exact command in the payload's log, writes the missing completion and doesn't resend. if the payload never got the command, recovery checks the "if the value is X" part again before applying it. a reused sequence number with different contents is rejected, so stale or conflicting commands can't sneak in.

<figure class="diagram">
<svg viewBox="0 0 600 230" role="img" aria-label="lost acknowledgement: payload applied 42 to 84 but the host has no completed entry; recovery finds the command in the payload log and writes the completion without resending">
<defs><marker id="cj-a2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<rect class="d-store" x="40" y="10" width="200" height="50" rx="4"/><text class="d-t" x="140.0" y="32" text-anchor="middle">host journal</text><text class="d-s" x="140.0" y="49" text-anchor="middle">accepted, no completed</text>
<rect class="d-store" x="360" y="10" width="200" height="50" rx="4"/><text class="d-t" x="460.0" y="32" text-anchor="middle">payload journal</text><text class="d-s" x="460.0" y="49" text-anchor="middle">applied 42 -&gt; 84</text>
<rect class="d-box" x="200" y="90" width="200" height="50" rx="4"/><text class="d-t" x="300.0" y="112" text-anchor="middle">recovery</text><text class="d-s" x="300.0" y="129" text-anchor="middle">finds it in the payload log</text>
<line class="d-line" x1="140" y1="60" x2="255" y2="88" marker-end="url(#cj-a2)"/><line class="d-line" x1="460" y1="60" x2="345" y2="88" marker-end="url(#cj-a2)"/><rect class="d-store" x="40" y="170" width="220" height="50" rx="4"/><text class="d-t" x="150.0" y="192" text-anchor="middle">host journal</text><text class="d-s" x="150.0" y="209" text-anchor="middle">completion written</text>
<rect class="d-box" x="340" y="170" width="220" height="50" rx="4"/><text class="d-t" x="450.0" y="192" text-anchor="middle">payload</text><text class="d-s" x="450.0" y="209" text-anchor="middle">command not resent</text>
<line class="d-line" x1="255" y1="140" x2="150" y2="168" marker-end="url(#cj-a2)"/><line class="d-line d-dash" x1="345" y1="140" x2="450" y2="168" marker-end="url(#cj-a2)"/>
</svg>
<figcaption>the crash case. the payload changed 42 to 84 but the host never wrote "completed". recovery reads both journals and fills in the completion.</figcaption>
</figure>

## the journal format

every journal entry carries a checksum (crc32c), a version and a length limit, and recovery checks that each entry is a valid next step, not just a valid checksum.

- a half-written entry at the very end gets cut off.
- a complete entry that fails its checks stops recovery. it never skips ahead to the next entry that looks fine, because that could silently drop a real command.
- both journals are checked before either one is repaired, since fixing one first could destroy the evidence of what the payload did.
- any disk error locks the executor until it's reopened.

<figure class="diagram">
<svg viewBox="0 0 600 190" role="img" aria-label="journal entry checks: a valid next step continues, a half-written final entry is cut off, a complete entry that fails its checks stops recovery">
<defs><marker id="cj-a3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<rect class="d-box" x="10" y="70" width="170" height="50" rx="4"/><text class="d-t" x="95.0" y="92" text-anchor="middle">entry read</text><text class="d-s" x="95.0" y="109" text-anchor="middle">crc32c, version, length</text>
<rect class="d-box" x="330" y="10" width="260" height="50" rx="4"/><text class="d-t" x="460.0" y="32" text-anchor="middle">valid next step</text><text class="d-s" x="460.0" y="49" text-anchor="middle">recovery goes on</text>
<rect class="d-box" x="330" y="70" width="260" height="50" rx="4"/><text class="d-t" x="460.0" y="92" text-anchor="middle">half-written, at the very end</text><text class="d-s" x="460.0" y="109" text-anchor="middle">cut off</text>
<rect class="d-box" x="330" y="130" width="260" height="50" rx="4"/><text class="d-t" x="460.0" y="152" text-anchor="middle">complete, but fails its checks</text><text class="d-s" x="460.0" y="169" text-anchor="middle">recovery stops, never skips ahead</text>
<line class="d-line" x1="180" y1="95" x2="328" y2="35" marker-end="url(#cj-a3)"/><line class="d-line" x1="180" y1="95" x2="328" y2="95" marker-end="url(#cj-a3)"/><line class="d-line" x1="180" y1="95" x2="328" y2="155" marker-end="url(#cj-a3)"/>
</svg>
<figcaption>what recovery does with each journal entry. a failed complete entry is never skipped past.</figcaption>
</figure>

## testing

the main test runs real processes and kills them at each of the nine write and sync points. it runs recovery twice and checks that the second run doesn't apply anything again. other tests flip each of 464 single bits, feed in every partial prefix of a journal, and cover symlinked logs and the single-writer lock.

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build
ctest --test-dir build --output-on-failure
d=$(mktemp -d); ./build/command-journal set "$d" 0 42
./build/command-journal set "$d" 42 84 --crash payload_sync; ./build/command-journal recover "$d"
```

## limits

exactly-once only holds if the payload records each command durably before acting on it. hardware that can act without recording it, or a disk that lies about syncing, needs a different design. the tests cover process crashes, not power loss or disk failure. there's no compaction yet, so a 64 MiB journal cap keeps this an experiment.
