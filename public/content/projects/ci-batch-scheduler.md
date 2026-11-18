# ci-batch-scheduler

the simple way to run ci is a fresh machine for every job. when a bunch of jobs from the same repo land close together, you pay machine startup over and over and run shared checks more than once. this rust simulator batches those jobs onto shared machines while still finishing every job before its deadline. on the evaluation workload it cut machines from 154 to 46 and machine time from 4,484 to 1,728 seconds, with no missed deadlines.

<figure class="diagram">
<svg viewBox="0 0 600 196" role="img" aria-label="results on the evaluation workload: machines 154 versus 46; machine-seconds 4,484 versus 1,728">
<defs><marker id="ci-a4" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<text class="d-t" x="10" y="16" text-anchor="start">machines</text><text class="d-s" x="10" y="41" text-anchor="start">simple way</text><rect class="d-store" x="110" y="24" width="400" height="26" rx="4"/><text class="d-t" x="518" y="42" text-anchor="start">154</text><text class="d-s" x="10" y="75" text-anchor="start">batched</text><rect class="d-box" x="110" y="58" width="120" height="26" rx="4"/><text class="d-t" x="238" y="76" text-anchor="start">46</text><text class="d-t" x="10" y="114" text-anchor="start">machine-seconds</text><text class="d-s" x="10" y="139" text-anchor="start">simple way</text><rect class="d-store" x="110" y="122" width="400" height="26" rx="4"/><text class="d-t" x="518" y="140" text-anchor="start">4,484</text><text class="d-s" x="10" y="173" text-anchor="start">batched</text><rect class="d-box" x="110" y="156" width="154" height="26" rx="4"/><text class="d-t" x="272" y="174" text-anchor="start">1,728</text>
</svg>
<figcaption>evaluation workload, no missed deadlines. bar lengths are to scale within each group.</figcaption>
</figure>

## how it decides when to launch

a batch takes the machine's startup time plus the time to run each distinct check once. subtract that from the earliest deadline among its jobs, and you get the last moment the batch can launch. until then, jobs can still move in and out of it.

<figure class="diagram">
<svg viewBox="0 0 600 145" role="img" aria-label="launch deadline rule: the latest launch is the earliest deadline minus startup and one run of each distinct check">
<defs><marker id="ci-a1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<text class="d-s" x="220" y="22" text-anchor="middle">latest launch, 20 s</text><text class="d-s" x="580" y="22" text-anchor="end">earliest deadline, 60 s</text><line class="d-line" x1="220" y1="28" x2="220" y2="38" marker-end="url(#ci-a1)"/><line class="d-line" x1="580" y1="28" x2="580" y2="38" marker-end="url(#ci-a1)"/><text class="d-s" x="130" y="62" text-anchor="middle">jobs can still move</text><text class="d-s" x="130" y="77" text-anchor="middle">in and out</text><rect class="d-box" x="220" y="40" width="90" height="50" rx="4"/><text class="d-t" x="265.0" y="62" text-anchor="middle">startup</text><text class="d-s" x="265.0" y="79" text-anchor="middle">10 s</text>
<rect class="d-box" x="310" y="40" width="180" height="50" rx="4"/><text class="d-t" x="400.0" y="62" text-anchor="middle">check x</text><text class="d-s" x="400.0" y="79" text-anchor="middle">20 s</text>
<rect class="d-box" x="490" y="40" width="90" height="50" rx="4"/><text class="d-t" x="535.0" y="62" text-anchor="middle">check y</text><text class="d-s" x="535.0" y="79" text-anchor="middle">10 s</text>
<line class="d-line" x1="40" y1="115" x2="580" y2="115"/><line class="d-line" x1="40" y1="111" x2="40" y2="119"/><text class="d-s" x="40" y="135" text-anchor="middle">0 s</text><line class="d-line" x1="220" y1="111" x2="220" y2="119"/><text class="d-s" x="220" y="135" text-anchor="middle">20 s</text><line class="d-line" x1="310" y1="111" x2="310" y2="119"/><text class="d-s" x="310" y="135" text-anchor="middle">30 s</text><line class="d-line" x1="490" y1="111" x2="490" y2="119"/><text class="d-s" x="490" y="135" text-anchor="middle">50 s</text><line class="d-line" x1="580" y1="111" x2="580" y2="119"/><text class="d-s" x="580" y="135" text-anchor="middle">60 s</text>
</svg>
<figcaption>the latest launch for jobs a and b below: deadline 60 s, minus 10 s startup, minus checks x (20 s) and y (10 s), gives 20 s.</figcaption>
</figure>

the scheduler always keeps a plan where every waiting job makes its deadline. it only swaps to a new grouping if that scores better: fewer machines first, then less total machine time. once a batch launches, it's fixed. the planner only ever sees jobs that have already arrived.

## why regrouping matters

say startup takes 10 seconds, and checks x, y and z take 20, 10 and 10 seconds. jobs A and B arrive at time 0, needing x and y. both must finish by time 60. together they take 40 seconds, so they're planned to launch at time 20.

<figure class="diagram">
<svg viewBox="0 0 600 115" role="img" aria-label="the example jobs: a and b arrive at 0 needing x and y with deadline 60; c arrives at 20 needing y and z with deadline 80">
<defs><marker id="ci-a2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<rect class="d-box" x="10" y="10" width="180" height="64" rx="4"/><text class="d-t" x="100.0" y="32" text-anchor="middle">job A</text><text class="d-s" x="100.0" y="49" text-anchor="middle">arrives 0, due 60</text><text class="d-s" x="100.0" y="64" text-anchor="middle">needs x and y</text>
<rect class="d-box" x="210" y="10" width="180" height="64" rx="4"/><text class="d-t" x="300.0" y="32" text-anchor="middle">job B</text><text class="d-s" x="300.0" y="49" text-anchor="middle">arrives 0, due 60</text><text class="d-s" x="300.0" y="64" text-anchor="middle">needs x and y</text>
<rect class="d-box" x="410" y="10" width="180" height="64" rx="4"/><text class="d-t" x="500.0" y="32" text-anchor="middle">job C</text><text class="d-s" x="500.0" y="49" text-anchor="middle">arrives 20, due 80</text><text class="d-s" x="500.0" y="64" text-anchor="middle">needs y and z</text>
<text class="d-s" x="300" y="100" text-anchor="middle">startup 10 s   check x 20 s   check y 10 s   check z 10 s</text>
</svg>
<figcaption>the three jobs in the example below.</figcaption>
</figure>

at time 20, job C arrives needing y and z, with a deadline of 80. putting all three together would take 50 seconds and miss the earlier deadlines. keeping A and B together and running C on its own costs 70 machine-seconds.

moving B into C's batch changes that. A alone takes 30 seconds. B and C share y and also take 30 seconds. both batches launch at time 30 and finish at time 60, and the same two machines now do 60 seconds of work instead of 70.

<figure class="diagram">
<svg viewBox="0 0 600 210" role="img" aria-label="regrouping: before, a and b together take 40 s and c alone takes 30 s for 70 machine-seconds; after, a alone and b with c each take 30 s for 60 machine-seconds, both launching at 30 and finishing at 60">
<defs><marker id="ci-a3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<text class="d-s" x="10" y="16" text-anchor="start">one box per machine, to scale in machine-seconds</text><text class="d-t" x="10" y="60" text-anchor="start">before</text><rect class="d-box" x="70" y="30" width="280" height="50" rx="4"/><text class="d-t" x="210.0" y="52" text-anchor="middle">A + B</text><text class="d-s" x="210.0" y="69" text-anchor="middle">launch 20, 40 s</text>
<rect class="d-box" x="350" y="30" width="210" height="50" rx="4"/><text class="d-t" x="455.0" y="52" text-anchor="middle">C alone</text><text class="d-s" x="455.0" y="69" text-anchor="middle">30 s</text>
<text class="d-s" x="560" y="100" text-anchor="end">70 machine-seconds</text><text class="d-t" x="10" y="155" text-anchor="start">after</text><rect class="d-box" x="70" y="125" width="210" height="50" rx="4"/><text class="d-t" x="175.0" y="147" text-anchor="middle">A alone</text><text class="d-s" x="175.0" y="164" text-anchor="middle">launch 30, 30 s</text>
<rect class="d-box" x="280" y="125" width="210" height="50" rx="4"/><text class="d-t" x="385.0" y="147" text-anchor="middle">B + C</text><text class="d-s" x="385.0" y="164" text-anchor="middle">launch 30, 30 s</text>
<text class="d-s" x="490" y="195" text-anchor="end">60 machine-seconds, both finish at 60</text>
</svg>
<figcaption>the same three jobs before and after moving b into c's batch.</figcaption>
</figure>

## keeping the search bounded

jobs that need exactly the same checks are treated as one entry. with up to 12 distinct sets of checks, the planner tries every possible grouping. bigger queues get a limited improvement search, and above 64 sets it keeps the quick heuristic plan. running out of search budget always leaves a working schedule in place.

the [planner](src/planner.rs) decides groupings. the [scheduler](src/scheduler.rs) owns waiting jobs, timers and launches. keeping them separate means the planner can never peek at future arrivals.

<figure class="diagram">
<svg viewBox="0 0 600 170" role="img" aria-label="planner and scheduler split: the scheduler owns waiting jobs, timers and launches and hands the planner only jobs that have arrived; the planner decides groupings and never sees future arrivals">
<defs><marker id="ci-a5" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<rect class="d-box" x="10" y="20" width="240" height="70" rx="4"/><text class="d-t" x="130.0" y="42" text-anchor="middle">scheduler</text><text class="d-s d-mono" x="130.0" y="59" text-anchor="middle">src/scheduler.rs</text><text class="d-s" x="130.0" y="74" text-anchor="middle">owns waiting jobs, timers, launches</text>
<rect class="d-box" x="350" y="20" width="240" height="70" rx="4"/><text class="d-t" x="470.0" y="42" text-anchor="middle">planner</text><text class="d-s d-mono" x="470.0" y="59" text-anchor="middle">src/planner.rs</text><text class="d-s" x="470.0" y="74" text-anchor="middle">decides groupings</text>
<line class="d-line" x1="252" y1="38" x2="348" y2="38" marker-end="url(#ci-a5)"/><text class="d-s" x="300" y="32" text-anchor="middle">waiting jobs</text><line class="d-line" x1="348" y1="64" x2="252" y2="64" marker-end="url(#ci-a5)"/><text class="d-s" x="300" y="78" text-anchor="middle">groupings</text><rect class="d-box" x="350" y="115" width="240" height="44" rx="4"/><text class="d-t" x="470.0" y="137" text-anchor="middle">future arrivals</text><text class="d-s d-warn" x="470.0" y="154" text-anchor="middle">never seen by the planner</text>
</svg>
<figcaption>who owns what. the planner only ever sees jobs that have already arrived.</figcaption>
</figure>

## testing

the [public tests](tests/scheduling.rs) compare 500 small cases against an independent brute-force solver, run both policies on 256 generated job streams, and check that changing future jobs can never change a launch decision already made. the evaluation inputs are private, so the repository includes a smaller runnable example.

## limits

the default policy doesn't win everywhere. in a broader synthetic comparison, regrouping only to save machines used fewer machines overall, while the default saved more machine time. the [design notes](docs/design.md) explain that tradeoff.

this is a simulation with known check durations and unlimited machines. a real service would also need machine quotas, durable launch records, retries and some slack for checks that run longer than expected.
