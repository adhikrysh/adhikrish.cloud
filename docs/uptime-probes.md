# uptime probes: how the status page knows what's up

`uptime.adhikrish.cloud` shows, for every service, whether it answered its last check, how fast, its last 24 hours and its 30-day uptime. this doc explains where each check runs, which road it takes to its service, where the results are kept, and why it's built this way.

**the short answer.** a timer fires every 5 minutes. it checks the public site and the cloudflare workers itself. it hands the self-hosted apps to a copy of the uptime worker that cloudflare runs near singapore, next to the thinkpad. every check stores one row in a d1 database. the public page only reads those rows, so a visit never sends traffic anywhere.

the code is [`private/admin/`](../private/admin/). the list of services is [`services.json`](../services.json).

## the pieces

- **worker.** a small program that cloudflare runs in its data centers instead of on a server you own. the uptime page is one, and so is senior intern.
- **handler.** a door into a worker. the uptime worker has two:
  - **`fetch`**, the request handler. it runs when an http request arrives: a visitor opening the page, or a call from another worker.
  - **`scheduled`**, the timer handler. cloudflare runs it on a cron schedule, here `*/5 * * * *` (every 5 minutes).
- **placement.** a setting that tells cloudflare *where* to run a worker's fetch handler. without it, a request runs in whichever data center received it.
- **service binding.** a direct line from one of your workers to another, declared in config. the call goes worker to worker inside cloudflare, with no public url, no internet and no access check.
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
| `colo` | `SIN` | the cloudflare data center the run started from, by airport code |

with 8 services and 12 runs an hour, that's about 2,300 rows a day. rows are kept for 30 days, about 69,000 at most. once a day, the run between 00:00 and 00:05 utc deletes anything older.

the page reads three things from it:

1. the newest row per service, for the dot and the time next to the name. hovering the time shows where it was measured from, like "measured from cloudflare SIN (singapore), through access and the tunnel to the thinkpad";
2. the last 24 hours grouped by hour, for the strip of ticks. an hour is red if any check in it failed;
3. the average of `up` over 30 days, for the percentage.

**how the data center is known.** a timer or a binding call carries no location, so each run asks cloudflare's trace endpoint (`https://adhikrish.cloud/cdn-cgi/trace`), which answers with the data center the request left from, `colo=SIN`. that request runs beside the probes and isn't timed. a latency number is only meaningful next to where it was measured from, which is why monitoring tools always label it, and why big public status pages often leave latency out entirely.

## why distance decides where a probe starts

latency is mostly distance. light in fibre covers about 200 km per millisecond, and singapore to the us west coast is about 13,600 km, so one round trip across the pacific costs well over 100 ms before any computer does any work.

a probe is timed from wherever its code runs. so the honest place to start a probe is next to the thing it checks:

| service | where it really lives | so the probe starts |
|---|---|---|
| self-hosted apps | the thinkpad in singapore, behind a tunnel that connects only to cloudflare's singapore data centers | near singapore |
| senior intern | a worker pinned next to its database, whose primary is in cloudflare SJC, san jose (d1 region `WNAM`) | at the timer, but the number is timed inside senior intern, so the start doesn't matter |
| the public site | static files served by every cloudflare data center | at the timer. any data center answers from right where it is |

before this split, every probe ran wherever the timer ran, mostly the us. every self-hosted app measured about 550 ms, and almost all of that was the ocean, not the box. after it, they measure about 50 ms.

## the cloudflare limitation, and the workaround

**where a timer runs.** cloudflare runs cron triggers in a data center of its choosing, usually one with spare capacity. for us that has been the us, though cloudflare doesn't promise it.

**what placement covers.** cloudflare's docs put it plainly: "placement only affects the execution of fetch event handlers". the timer handler isn't a fetch handler, so pinning the uptime worker to singapore does nothing for the timer.

**the workaround.** for the self-hosted apps, the timer sends one request to its own worker's fetch handler, through a service binding to itself (`SELF`). that handler *is* pinned, so those probes run near singapore. the timer checks everything else itself, at the same moment.

```text
every 5 minutes
    cloudflare -> scheduled handler                  (wherever cloudflare chooses, so far the us)
                     |
                     |-> probe the public site        (road 1)
                     |-> probe senior intern          (road 2, over its binding)
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
SENIORINTERN: bindings.worker({ worker: "snrintern" }),
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
    -> SENIORINTERN binding (no url, no internet, no access)
    -> senior intern's fetch handler, /health    (placement: next to its database)
         -> SELECT 1 against its d1 database
    <- "ok", or 503 "database unreachable"
```

senior intern is another worker, so the timer calls it directly through a service binding instead of over its public url.

**senior intern has its own placement.** [`private/snrintern/cloudflare.config.ts`](../private/snrintern/cloudflare.config.ts) pins it next to its database:

```ts
placement: { region: "aws:us-west-1" },   // amazon's northern california region, next to the database's primary in SJC
```

this matters far more for the agent than for this page. every agent request runs several database queries, and each one is now a short trip instead of a crossing from wherever the request came in.

**senior intern times itself.** `/health` answers with a small report: `{ ok, ms, ran, db }`. `ms` is how long its own `SELECT 1` took, measured inside senior intern. `ran` is cloudflare's `cf-placement` header: `remote-SJC` means placement moved it next to the database, and `local-ATL` would mean it ran where the call arrived. `db` is the data center the database answered from. the uptime page shows senior intern's own `ms`, so its number is the database's speed for senior intern, wherever cloudflare happened to run the timer. the hover note shows where senior intern ran.

**how we found the database.** a d1 query's metadata names the data center that served it: `served_by_colo: "SJC"`, `served_by_primary: true`. the first pin was `aws:us-west-2` (oregon), chosen from the region name alone. the metadata showed the primary is in san jose, so the pin moved to `aws:us-west-1`.

**why `/health` touches the database.** a check that only proves the worker's code runs is a *liveness* check. on cloudflare that's almost always true, so it would show green forever, even on a day when every real request fails because the database is down. a check that proves the service can do its job, by reaching what it depends on, is a *readiness* check. `SELECT 1` is the smallest question a database can answer ("give me the number 1"). it reads no table and only proves the database replied.

### 3. self-hosted: everything on the thinkpad

```text
fetch handler, /_probe (near singapore)
    -> https://<app>.adhikrish.cloud/<health path>, with the prober's service token
    -> cloudflare singapore: access checks the token
    -> tunnel -> nginx proxy manager on the thinkpad -> the app's container
    <- the app's answer
```

the thinkpad isn't on cloudflare, so a binding can't reach it. the only road is the public one through access and the tunnel. that's also the road real users take, so it's the right thing to measure. the prober carries its own service token (`uptime-prober`) because access guards every self-hosted name. see [`access.md`](access.md).

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
- **senior intern's `/health`** needs no login of its own, but from the internet it still sits behind access, so only you and the agent can reach it. and all it can do is answer "1". the uptime worker reaches it over the binding, which skips access, so the prober's token isn't on senior intern's access app at all.
- **the prober's token** is sent only to the self-hosted apps, the only things that check it.

## the dead ends, and what they taught

1. **props as a lock.** the first version locked `/_probe` and senior intern's check with `props`, a label cloudflare attaches to calls through a binding. both locks turned away the real calls: the log showed `probe run: 404 not found`, and no probes were stored for two runs. cloudflare delivers props only to *named entrypoints* (separately exported classes), not to a worker's default handler.
2. **a named entrypoint for senior intern.** moving its check into a named class fixed the lock, because a named class has no url at all. but placement "does not affect named entrypoints", so the check ran wherever its caller was, which was singapore at the time. its `SELECT 1` crossed the pacific to the database, and senior intern measured about 300 ms.
3. **what stuck.** each probe starts where its service lives. the timer checks the cloudflare-hosted services itself, and senior intern's check sits on its default handler, where its own placement applies.

the general lesson: check where each feature applies before building on it. placement, props and named entrypoints each work on a different kind of handler.

## predicting what happens

1. **the thinkpad loses power.** the next run probes every self-hosted app, cloudflare can't reach the tunnel, and each stores a `530`, shown as "tunnel unreachable". the site and senior intern stay green, because they don't depend on the box.
2. **someone reloads the uptime page 10,000 times.** each load is a few database reads. the box sees nothing, and no probe runs.
3. **someone requests `uptime.adhikrish.cloud/_probe`.** 404. no key, no run.
4. **senior intern's database has an outage.** `SELECT 1` fails, `/health` returns 503, and senior intern turns red with "server error 503", even though its worker is fine.
5. **cloudflare starts running the timer in europe.** the self-hosted numbers don't change, because they're still probed from singapore. the public site barely changes. senior intern's number rises a little, because the binding call now crosses an ocean before reaching its database.
6. **you add a new self-hosted app.** add one entry to `services.json` with its url and, if it has one, a health path. it gets probed from singapore along road 3. see [`add-a-service.md`](add-a-service.md).
7. **you add a new cloudflare worker.** add it to `services.json` with a `binding` name, add a matching `bindings.worker({ worker })` line to the uptime config, and give it a `/health` that checks what it depends on. if it has a database, place it next to that database.

## what it costs

each run sends one request per service, 8 every 5 minutes, about 2,300 a day, roughly 2% of the free plan's 100,000. senior intern's check adds one tiny database read per run. each run writes 8 rows, and old rows are deleted once a day after 30 days. a page view is a few database reads.

## open questions

- where cloudflare runs the timer isn't promised. so far it has been the us. senior intern's numbers would show a change (case 5).
- the probes measure each service from near where it lives, so they show its health, not what a visitor elsewhere would see. that's on purpose: this page answers "is it up and healthy", not "how fast is it for you".
