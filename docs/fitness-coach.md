# fitness coach: why senior intern has training numbers, and who reasons over them

what is the fitness coach, why does it exist, and what has been decided about it so far?

**the short answer.** the coach is a personal agent (any agent, through the api) that looks at your training and health and tells you what to do, so you don't have to read charts and work it out yourself. senior intern never reasons: it stores the data, merges garmin with what the agent logs, and computes a few honest numbers. the agent reads those numbers and does the thinking. all three layers are built: the coaching itself is a skill senior intern serves, [`private/snrintern/skills/fitness-coach.md`](../private/snrintern/skills/fitness-coach.md).

## why it exists

the point is to remove cognitive load. a watch already records everything, and a dashboard already shows everything, but neither tells you what to do today. reading load charts, remembering your longest run, and deciding whether to rest is exactly the work you want gone.

so the split is:

- **the frontend is for observability.** you open it rarely, to check something. it is not where advice happens.
- **the agent is where advice happens.** it talks to you where you already are, and it can speak first (a morning check-in), instead of waiting for you to open a page.
- **the worker never calls an ai.** reasoning belongs to the client. that keeps the worker small, cheap, inside cloudflare's free plan, and keeps the agents interchangeable: everything an agent needs is behind the api, so swapping one agent for another changes nothing in senior intern.

## the three layers

```text
layer 1  ingest      garmin activities + the agent's sessions
                     → one training log (built, live)
    │
    ▼
layer 2  numbers     per-request arithmetic over that log
                     → GET /api/<tab>/_views (built, live)
    │
    ▼
layer 3  coaching    a skill the agent reads and follows
                     → reasons, asks, advises (built)
```

### layer 1: one log, merged at ingestion (built)

every garmin activity lands in the training tab, merged with the sessions the agent writes. there is no etl pipeline: the merge happens when the data comes in, so there's no second copy to keep in sync.

- a garmin activity and an agent session are the same session when they're on the same local day and start within 2 hours of each other, closest first.
- garmin owns the measurements (time, distance, heart rate, load, zones, splits). the agent owns what only you know (`focus`, `lifts`, `rpe`, `notes`). neither overwrites the other.
- the agent must log a session's start time, not just the date, or two sessions on one day can't be told apart.
- weigh-ins go into body.

the full mechanism: [`training.md`](training.md).

### layer 2: numbers, computed per request (built)

the agent should never read hundreds of raw rows and do arithmetic: that's a lot of context, and models get sums wrong. so senior intern computes a few numbers and serves them at `GET /api/training/_views` and `GET /api/health/_views`. nothing is stored, so a backfilled run, a deleted activity or a fixed row is reflected on the next request.

| number | what it says | why this one |
|---|---|---|
| load | the last 7 days of garmin's training load against your own past weeks: "higher" or "lower than usual" | judged against your own history, not a made-up target |
| run limit | the longest run of the last 30 days, and the next run's limit 10% past it; any run that went past it, in red | frandsen et al., bjsm 2025: a single run more than 10% longer than your 30-day longest raised overuse injuries |
| weeks | per sport: this week's time and distance, 12 weeks of history, heart-rate zones over 28 days | how the week is going, by sport |
| records | best of the last 90 days against best ever | progress, without inventing goals |
| health verdicts | each day's sleep, hrv, body battery, stress, steps, resting hr | garmin's own labels and bands first; your own history only where garmin has none |

### layer 3: the coaching skill (built)

without it the agent was a careful clerk: it logged sessions well, but when fitness came up it asked what you'd done instead of looking. the skill closes that gap.

```text
every conversation
  GET /api/_agents   adhi's AGENTS.md, the api core, and the
                     skills index: "fitness-coach: when
                     training, health, sleep ... comes up"
        │
        ▼  something about training comes up
  GET /api/_skills/fitness-coach   the procedure
        │
        ├─► reads health and training /_views, the last
        │   sessions, the obsessions
        ├─► decides the day (easy, back off, push), never
        │   past the run limit
        ├─► asks only what data can't know (soreness,
        │   where, time)
        └─► one message: how you're doing, then sessions
            by time available
```

- the skill is a file in this repo, served by the worker. it changes with each deploy, so nobody re-pastes anything, and every agent gets the same coach.
- every skill opens with `name` and `when`. the worker lists them in `/api/_agents` and `GET /api`, so an agent knows a skill exists before it needs it, and reads the body only then.
- a test checks that the served skill matches the file and that the index names it.

## decisions

- **reasoning lives in the client agent, never in the worker.** no ai calls from senior intern.
- **everything goes through the api,** so any agent can be the coach.
- **no etl.** garmin is merged at ingestion; the numbers are computed per request.
- **the agent reads `/_views`, not raw rows.**
- **the frontend is for observability.** numbers that only the agent acts on (load, run limit, weeks) are kept off the training page (`page: false`) and stay in `/_views`. sessions, lift progress, bodyweight and records stay on the page.
- **no acute:chronic ratio.** dividing 7-day load by 28-day load, with a 0.8 to 1.3 "sweet spot" (gabbett, 2016), doesn't hold up: the 7 days sit inside the 28, so part of the link is arithmetic (lolli et al., 2019), the ratio hides how much work it describes, and the curve wasn't validated (impellizzeri et al., 2020). in the 2025 garmin runners study, weekly ratio spikes went with *fewer* injuries.
- **no targets we invent.** a judgement comes from the source of truth (garmin's labels and bands, a clinical bound, a study) or from your own history.
- **the run limit applies to runs only,** because the study covers recreational runners and running distance and nothing else.

## open questions

- **goals.** the skill reads obsessions today. a lower layer of measurable targets and weekly constraints is being designed; the skill will read it once it exists.
- **the morning check-in.** it needs the agent's own scheduler. which platform the agent runs on, and whether it can run on a timer, isn't settled.
- **whether the agent's platform has native skills.** the api-served skill works for any agent; a native one would only matter if it's meaningfully better there.
- **is it used?** worker logs would show `GET /api/_skills/fitness-coach`; nobody has checked a week of them yet.
