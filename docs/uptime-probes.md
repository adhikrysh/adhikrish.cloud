# uptime probes: how the status page knows what's up

`uptime.adhikrish.cloud` shows, for every service, whether it answered its last check, how fast, its last 24 hours and its 30-day uptime. this doc explains where each check runs, which road it takes to its service, where the results are kept, and why it's built this way.

**the short answer.** a timer fires every 5 minutes. it checks the public site and senior intern itself. it hands the self-hosted apps to a copy of the uptime worker that cloudflare runs near singapore, next to the thinkpad. every check stores one row in a d1 database. the public page only reads those rows, so a visit never sends traffic anywhere.

the code is [`private/admin/`](../private/admin/). the list of services is [`services.json`](../services.json).

## the pieces

- **worker.** a small program that cloudflare runs in its data centers instead of on a server you own. the uptime page is one, and so is senior intern.
- **handler.** a door into a worker. the uptime worker has two:
  - **`fetch`**, the request handler. it runs when an http request arrives: a visitor opening the page, or a call from another worker.
  - **`scheduled`**, the timer handler. cloudflare runs it on a cron schedule, here `*/5 * * * *` (every 5 minutes).
- **placement.** a setting that tells cloudflare *where* to run a worker's fetch handler. without it, a request runs in whichever data center received it.
- **service binding.** a direct line from one of your workers to another, declared in config. the call goes worker to worker inside cloudflare, with no public url and no access check.
- **probe.** one check of one service. it records whether the service answered (`up`), the http status, the time taken (`ms`) and, if it failed, why (`error`).
- **d1.** cloudflare's sqlite database. senior intern keeps its data in one. the uptime worker keeps its probes in another.

## where the data lives

the uptime worker's d1 database, `admin-uptime`, has one table, `probes`. every check writes one row:

| column | example | meaning |
|---|---|---|
| `service` | `immich` | which service |
| `at` | `1795125900000` | when the run started, in unix milliseconds |
| `up` | `1` | answered properly (1) or not (0) |
| `status` | `200` | the http status it got |
| `ms` | `48` | how long it took |
| `error` | `tunnel unreachable` | why it failed, empty if it didn't |

with 8 services and 12 runs an hour, that's about 2,300 rows a day. rows are kept for 30 days, about 69,000 at most. once a day, the run between 00:00 and 00:05 utc deletes anything older.

the page reads three things from it:

1. the newest row per service, for the dot and the time next to the name;
2. the last 24 hours grouped by hour, for the strip of ticks. an hour is red if any check in it failed;
3. the average of `up` over 30 days, for the percentage.

## why distance decides where a probe starts

latency is mostly distance. light in fibre covers about 200 km per millisecond, and singapore to the us west coast is about 13,600 km, so one round trip across the pacific costs well over 100 ms before any computer does any work.

a probe is timed from wherever its code runs. so the honest number is one measured next to the thing being checked:

| service | where it really lives | how the number stays honest |
|---|---|---|
| self-hosted apps | the thinkpad in singapore, behind a tunnel that connects only to cloudflare's singapore data centers | the probe starts near singapore |
| senior intern | a worker placed next to its database, whose primary is in cloudflare SJC, san jose | senior intern times its own database query, so where the probe starts doesn't matter |
| the public site | static files served by every cloudflare data center | none needed: any data center answers from right where it is |

before this, every probe ran wherever the timer ran. every self-hosted app measured about 550 ms, and almost all of that was the ocean, not the box. after it, they measure about 50 ms.

## the cloudflare limitation, and the workaround

**where a timer runs.** cloudflare runs cron triggers in a data center of its choosing, usually one with spare capacity. we've seen the same timer run in warsaw, atlanta, amsterdam and dallas within half an hour.

**what placement covers.** cloudflare's docs put it plainly: "placement only affects the execution of fetch event handlers". the timer handler isn't a fetch handler, so pinning the uptime worker to singapore does nothing for the timer.

**the workaround.** for the self-hosted apps, the timer sends one request to its own worker's fetch handler, through a service binding to itself (`SELF`). that handler *is* pinned, so those probes run near singapore. the timer checks the rest itself, at the same moment.

```text
every 5 minutes
    cloudflare -> scheduled handler                  (wherever cloudflare chooses)
                     |
                     |-> probe the public site        (road 1)
                     |-> probe senior intern          (road 2)
                     |
                     |-> SELF.fetch("/_probe") ----> fetch handler, /_probe   (placement: near singapore)
                     |                                  |-> probe every self-hosted app   (road 3)
                     v                                  v
                  rows -> d1                         rows -> d1
```

the hop from the timer to singapore isn't timed. only the probes are.

the uptime worker's config, in [`private/admin/cloudflare.config.ts`](../private/admin/cloudflare.config.ts):

```ts
placement: { region: "aws:ap-southeast-1" },     // run the fetch handler near amazon's singapore region
SELF: bindings.worker({ worker: "admin" }),        // this worker, bound to itself
```

placement takes a cloud region rather than one of our hostnames. our hostnames resolve to cloudflare itself, so cloudflare would just measure the distance to its own nearest data center. `aws:ap-southeast-1` is amazon's singapore region, and cloudflare runs the worker in its data center closest to it.

## the three roads

### 1. public, on cloudflare: the site

```text
timer
    -> https://adhikrish.cloud/        (no token: the site is public)
    -> nearest cloudflare data center, which serves the static files itself
    <- 200
```

the request goes to the public url, exactly like a visitor's. the site is static files served at the edge, so it's answered in the nearest data center, and where the probe starts barely matters.

### 2. private, on cloudflare: senior intern

```text
timer
    -> https://seniorintern.adhikrish.cloud/health, with the prober's service token
    -> nearest cloudflare data center: access checks the token
    -> placement moves the request to senior intern near SJC, next to its database
         -> SELECT 1, timed inside senior intern
    <- { ok: true, ms: 2 }
```

this is the road the agent's requests take, through access, and placement applies to it.

**senior intern is placed next to its database.** [`private/snrintern/cloudflare.config.ts`](../private/snrintern/cloudflare.config.ts):

```ts
placement: { region: "aws:us-west-1" },   // amazon's northern california region, next to the database's primary in SJC
```

this matters more for the agent than for this page. every agent request runs several database queries, and each one is a short trip instead of a crossing from wherever the request came in.

**how we found the database.** a d1 query's metadata names the data center that served it: `served_by_colo: "SJC"`, `served_by_primary: true`.

**senior intern times itself.** `/health` answers `{ ok, ms }`, where `ms` is how long its own `SELECT 1` took, measured inside senior intern. the page shows that number, so it's the database's speed for senior intern, wherever cloudflare happened to run the timer.

**why `/health` touches the database.** a check that only proves the worker's code runs is a *liveness* check. on cloudflare that's almost always true, so it would show green forever, even on a day when every real request fails because the database is down. a check that proves the service can do its job, by reaching what it depends on, is a *readiness* check. `SELECT 1` is the smallest question a database can answer ("give me the number 1"). it reads no table and only proves the database replied.

### 3. self-hosted: everything on the thinkpad

```text
fetch handler, /_probe (near singapore)
    -> https://<app>.adhikrish.cloud/<health path>, with the prober's service token
    -> cloudflare singapore: access checks the token
    -> tunnel -> nginx proxy manager on the thinkpad -> the app's container
    <- the app's answer
```

the thinkpad isn't on cloudflare, so the only road is the public one through access and the tunnel. that's also the road real users take, so it's the right thing to measure. see [`access.md`](access.md).

### how a failure is told apart

the probe never follows redirects, and it gives up after 5 seconds. so what comes back says where the road broke:

| what comes back | what it means |
|---|---|
| a redirect to `*.cloudflareaccess.com` | access refused the prober's token |
| `530` | cloudflare can't reach the tunnel: the box or cloudflared is down |
| `502`, `503`, `504` | the tunnel works, but the app behind the proxy didn't answer properly |
| nothing within 5 s | too slow, counted as down |
| `503` from senior intern | its worker runs, but its database didn't answer |

## the page never probes

the public page only reads the database.

```text
visitor -> uptime.adhikrish.cloud -> fetch handler, "/" -> read d1 -> html
                                                        (0 requests to any service)
```

it used to probe every service on every visit. that's fine for a private page, but on a public one anyone reloading it in a loop would push traffic through the tunnel into the box and burn the free plan's daily requests. reading stored rows instead means the page can be up to 5 minutes old, which is normal for a status page.

## who can make it do work

- **the uptime worker's `/_probe`** runs only if the request carries the header `x-probe-key` with the prober's secret. that secret lives in cloudflare's secret storage and never reaches a browser, and only the timer sends it. from outside, `/_probe` returns 404.
- **senior intern's `/health`** sits behind access like every other path: only your google login, the agent's token and the prober's token get through. it needs no login of its own after that, and all it can do is answer "1". the prober's token can't read data: senior intern only accepts the agent's token for that.
- **the prober's token** goes only to private services, where access checks it. the public site gets no token.

## the dead ends, and what they taught

1. **props as a lock.** the first version locked `/_probe` with `props`, a label cloudflare attaches to calls through a binding. it turned away the timer's own calls: the log showed `probe run: 404 not found`, and no probes were stored for two runs. cloudflare delivers props only to *named entrypoints* (separately exported classes), not to a worker's default handler. and placement "does not affect named entrypoints", so `/_probe` couldn't move into one. it uses a secret header instead.
2. **senior intern over a binding.** calling senior intern through a service binding skipped access, which seemed cleaner. the docs suggest a bound worker runs where its own placement says. our measurements disagreed: senior intern's health check spent about 118 ms of 119 ms waiting on the database, with 1 ms of cpu, and no `cf-placement` header arrived. it ran beside the timer, wherever that was, and its query crossed to san jose from there. so senior intern went back to its public url, where placement does apply.
3. **a placement guessed from a region name.** the first pin was `aws:us-west-2` (oregon), from the database's region `WNAM` alone. the database's own metadata said `SJC`, so the pin moved to `aws:us-west-1`.
4. **showing where each number was measured.** a hover label beside each time ("measured from singapore (SIN)") looked cluttered and broke the row's alignment, so it went. the reasoning stays here instead.

the general lesson: check where each feature applies before building on it, and measure, because the docs can be ambiguous. placement, props, named entrypoints and bindings each behave differently.

## predicting what happens

1. **the thinkpad loses power.** the next run probes every self-hosted app, cloudflare can't reach the tunnel, and each stores a `530`, shown as "tunnel unreachable". the site and senior intern stay green, because they don't depend on the box.
2. **someone reloads the uptime page 10,000 times.** each load is a few database reads. the box sees nothing, and no probe runs.
3. **someone requests `uptime.adhikrish.cloud/_probe`.** 404. no key, no run.
4. **senior intern's database has an outage.** `SELECT 1` fails, `/health` returns 503, and senior intern turns red with "server error 503", even though its worker is fine.
5. **cloudflare runs the timer in europe.** the self-hosted numbers don't change, because they're probed from singapore. senior intern's number doesn't change either, because it times itself.
6. **you add a new self-hosted app.** add one entry to `services.json` with its url and, if it has one, a health path. it gets probed from singapore along road 3. see [`add-a-service.md`](add-a-service.md).
7. **you add a new cloudflare worker.** add it to `services.json` with `"cloudflare": true` and a `health` url. give it a `/health` that checks what it depends on and answers `{ ok, ms }`. if it has a database, place it next to that database's primary.

## what it costs

each run sends one request per service, 8 every 5 minutes, about 2,300 a day, roughly 2% of the free plan's 100,000. senior intern's check adds one tiny database read per run. each run writes 8 rows, and old rows are deleted once a day after 30 days. a page view is a few database reads.

## open questions

- whether a service binding to a placed worker is meant to run that worker placed. the docs suggest yes, and our measurement said no. we avoid relying on it.
- the probes measure each service from near where it lives, so they show its health, not what a visitor elsewhere would see. that's on purpose: this page answers "is it up and healthy", not "how fast is it for you".
