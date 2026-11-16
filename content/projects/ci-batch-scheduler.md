# ci batch scheduler

starting a new machine for every code-checking job repeats both machine startup and checks that several jobs need. this rust simulator groups jobs from the same repository so they can share that work while each job still finishes before its deadline.

## deciding when to launch

a batch takes the machine's startup time plus the duration of its distinct checks. subtract that duration from the earliest deadline among its jobs to find the last moment it can launch. until then, its membership can change as new jobs arrive.

the scheduler keeps a feasible plan for every waiting job. it replaces a grouping only when doing so improves its score: fewer virtual machines first, then less total machine execution time. once a batch launches, its membership is fixed. the planner sees only jobs that have already arrived.

## why regrouping matters

suppose startup takes 10 seconds and checks x, y, and z take 20, 10, and 10 seconds. jobs A and B arrive at time zero needing x and y. both must finish by time 60. together they take 40 seconds, so their planned launch is time 20.

at time 20, job C arrives needing y and z, with a deadline of time 80. putting all three together would take 50 seconds and miss the earlier deadlines. keeping A and B together and running C separately costs 70 machine-seconds.

moving B into C's batch changes the result. A takes 30 seconds; B and C share y and also take 30 seconds. both batches can launch at time 30 and finish at time 60. the same two machines now do 60 seconds of work.

## bounded search

jobs needing identical checks share one search entry. for up to 12 distinct check sets, the planner searches every partition of those sets. larger queues receive a bounded improvement search; above 64 sets it keeps the heuristic plan. exhausting the search budget leaves a feasible schedule in place.

the [planner](src/planner.rs) owns these grouping decisions. the [scheduler](src/scheduler.rs) owns waiting jobs, timers, and launches. separating them keeps future arrivals outside the planner's view.

## results and limits

on the supplied evaluation workload, immediate launch uses 154 virtual machines and 4,484 machine-seconds. regrouping uses 46 machines and 1,728 machine-seconds, with no missed deadlines. those inputs are private; the repository includes a smaller runnable example and generated tests.

the [public tests](tests/scheduling.rs) compare 500 small cases with an independent exhaustive solver, check both policies on 256 generated streams, and verify that changing future jobs cannot change past launch decisions.

the default policy does not win on every workload. a broader synthetic comparison found that regrouping only to save machines used fewer machines overall, while the default saved more execution time. the [design notes](docs/design.md) explain that tradeoff.

this is a simulation with known check durations and unlimited concurrent machines. an operating service would also need machine quotas, durable launch records, retries, and a margin for checks that overrun their estimates.
