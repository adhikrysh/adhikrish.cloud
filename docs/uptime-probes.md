# uptime probes: how the status page knows what's up

`uptime.adhikrish.cloud` shows, for every service, whether it answered its last check, how fast, its last 24 hours and its 30-day uptime. this doc explains where those checks run, which road each one takes to its service, and why it's built this way.

**the short answer.** a timer fires every 5 minutes. it hands the work to the uptime worker's own request handler, which cloudflare runs near singapore, where the thinkpad is. that handler checks every service at once, each along its own road, and stores one row per service in a d1 database. the public page only reads those rows, so a visit never sends traffic anywhere.

the code is [`private/admin/`](../private/admin/). the list of services is [`services.json`](../services.json).

## the pieces

- **worker.** a small program that cloudflare runs in its data centers instead of on a server you own. the uptime page is one. so is senior intern.
- **handler.** a door into a worker. the uptime worker has two:
  - **`fetch`**, the request handler. it runs when an http request arrives: a visitor opening the page, or a call from another worker.
  - **`scheduled`**, the timer handler. cloudflare runs it on a cron schedule, here `*/5 * * * *` (every 5 minutes).
- **placement.** a setting that tells cloudflare *where* to run a worker. without it, a request runs in whichever data center received it.
- **service binding.** a direct line from one of your workers to another, declared in config. the call goes straight from worker to worker inside cloudflare, with no public url, no internet and no access check.
- **probe.** one check of one service. it records whether the service answered (`up`), the http status, the time taken (`ms`) and, if it failed, why (`error`).
- **d1.** cloudflare's sqlite database. the `probes` table holds one row per probe and keeps 30 days of them.

## why the probes have to run near singapore

latency is mostly distance. light in fibre covers about 200 km per millisecond, and singapore to the us west coast is about 13,600 km, so one round trip across the pacific costs well over 100 ms before any computer does any work.

the thinkpad is in singapore, and its tunnel connects only to cloudflare's singapore data centers. so a probe that starts in the us travels like this:

```text
probe starts in a us data center
    -> crosses the pacific to cloudflare singapore
    -> tunnel -> the thinkpad
    <- and all the way back
```

before placement, every self-hosted service measured about 550 ms, and almost all of that was the ocean, not the box. a probe that starts in singapore skips the crossing, so what it measures is the box.

## the cloudflare limitation, and the workaround

**where a timer runs.** cloudflare runs cron triggers in a data center of its choosing, usually one with spare capacity. for us that has mostly been in the us.

**what placement covers.** cloudflare's docs put it plainly: "placement only affects the execution of fetch event handlers". the `scheduled` handler is not a fetch handler, so pinning the worker to singapore does nothing for the timer.

**the workaround.** the timer does almost nothing itself. it sends one request to its own worker's `fetch` handler, through a service binding to itself (`SELF`). that handler *is* pinned, so the probing runs near singapore.

```text
every 5 minutes
    cloudflare -> scheduled handler          (runs wherever cloudflare chooses, often the us)
                     |
                     |  SELF.fetch("/_probe")   one call, worker to itself
                     v
                  fetch handler, /_probe     (placement: runs near singapore)
                     |
                     |-> probe every service, all at once
                     v
                  one row per service -> d1
```

the hop from the timer to the fetch handler may cross the pacific, but it isn't timed. only the probes are timed, and they start in singapore.

the config, in [`private/admin/cloudflare.config.ts`](../private/admin/cloudflare.config.ts):

```ts
placement: { region: "aws:ap-southeast-1" },        // run the fetch handler near amazon's singapore region
SELF: bindings.worker({ worker: "admin" }),
```

placement takes a cloud region rather than our own hostname. that's because our hostnames resolve to cloudflare itself, so cloudflare would just measure the distance to its own nearest data center. `aws:ap-southeast-1` is amazon's singapore region, and cloudflare runs the worker in its data center closest to it.

## the three roads

every probe starts in the same place, the pinned fetch handler. what differs is the road to the service, and that depends on where the service lives.

### 1. public, on cloudflare: the site

```text
fetch handler (singapore)
    -> https://adhikrish.cloud/
    -> nearest cloudflare data center (singapore), which serves the static files itself
    <- 200
```

the request goes to the public url, exactly like a visitor's. the site is static files served at the edge, so it's answered in the nearest data center, and the probe's location barely changes the number.

### 2. private, on cloudflare: senior intern

```text
fetch handler (singapore)
    -> SENIORINTERN binding (no url, no internet, no access)
    -> senior intern's Health entrypoint
         -> SELECT 1 against its d1 database (in one region, likely the us)
    <- "ok", or 503 "database unreachable"
```

senior intern is another worker, so the uptime worker calls it directly through a service binding instead of over its public url. the binding points at a **named entrypoint**: a separate exported class, `Health`, in [`private/snrintern/src/index.ts`](../private/snrintern/src/index.ts).

```ts
SENIORINTERN: bindings.worker({ worker: "snrintern", exportName: "Health" }),
```

a named entrypoint has no url at all. the internet can only reach a worker's default handler, so the only way to call `Health` is a binding that names it, and only the uptime worker has one.

**why `/health` touches the database.** a check that only proves the worker's code runs is a *liveness* check. on cloudflare that's almost always true, so it would show green forever, even on a day when every real request fails because the database is down. a check that proves the service can do its job, by reaching what it depends on, is a *readiness* check. `SELECT 1` is the smallest question a database can answer ("give me the number 1"). it reads no table and only proves the database replied.

**the cost.** the database lives in one region. from a singapore probe, that one query crosses the pacific, so senior intern shows a higher number than a caller in the us would see. that's an honest number for a request starting in asia.

### 3. self-hosted: everything on the thinkpad

```text
fetch handler (singapore)
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

the public page only reads the database: the newest row per service, plus the history for the strips.

```text
visitor -> uptime.adhikrish.cloud -> fetch handler, "/" -> read d1 -> html
                                                        (0 requests to any service)
```

it used to probe every service on every visit. that's fine for a private page, but on a public one anyone reloading it in a loop would push traffic through the tunnel into the box and burn the free plan's daily requests. reading stored rows instead means the page can be up to 5 minutes old, which is normal for a status page.

## who can start a probe

two things could do work on request. neither can be triggered from the internet.

- **senior intern's health check** is the `Health` named entrypoint. it has no url, so a request from the internet can't reach it. the public `/health` path is just an ordinary path behind access and the worker's own login check.
- **the uptime worker's `/_probe`** runs only if the request carries the header `x-probe-key` with the prober's secret. that secret lives in cloudflare's secret storage and never reaches a browser. only the timer sends it, through `SELF`. from outside, `/_probe` returns 404.

**the mistake we made first.** the first version locked both with `props`, a label cloudflare attaches to calls through a binding. both locks turned away the real calls: the live log showed `probe run: 404 not found`, and no probes were stored for two runs. cloudflare's docs explain why: props are delivered to *named entrypoints*, not to a worker's default handler. that left two different fixes:

- senior intern's check moved into a named entrypoint, which is better anyway, because having no url is a stronger lock than a label.
- the uptime worker couldn't do the same. placement "does not affect named entrypoints", so moving `/_probe` into one would lose the singapore pin. it stays on the default handler and checks a secret instead.

so the prober's token isn't on senior intern's access app at all. it only opens the self-hosted apps it checks, and it's only sent to them: the public site and the binding get no token.

## predicting what happens

1. **the thinkpad loses power.** the next run probes every self-hosted app, cloudflare can't reach the tunnel, and each one stores a `530`, shown as "tunnel unreachable". the site and senior intern stay green, because they don't depend on the box.
2. **someone reloads the uptime page 10,000 times.** each load is one database read. the box sees nothing, and no probe runs.
3. **someone requests `uptime.adhikrish.cloud/_probe`.** 404. no key, no run.
4. **senior intern's database has an outage.** `SELECT 1` fails, `/health` returns 503, and senior intern turns red with "server error 503", even though its worker is fine.
5. **you add a new self-hosted app.** add one entry to `services.json` with its url and, if it has one, a health path. nothing else changes: it gets probed from singapore along road 3. see [`add-a-service.md`](add-a-service.md).
6. **you add a new cloudflare worker.** give it a `Health` named entrypoint like senior intern's, add it to `services.json` with a `binding` name, and add a matching `bindings.worker({ worker, exportName: "Health" })` line to the uptime config.

## what it costs

each run sends one request per service, all at once. that's 8 every 5 minutes, about 2,300 a day, roughly 2% of the free plan's 100,000. each run writes 8 rows, and old rows are deleted once a day after 30 days. a page view is a few database reads.

## open questions

- whether placement holds when the fetch handler is reached through the self binding, rather than from the internet, is inferred from cloudflare's docs and checked by the numbers after deploy. each run reports the data center it ran in, in the worker's logs.
- the probes start near singapore, so they measure the box's health, not what a visitor elsewhere would see. that's on purpose: this page answers "is it up and healthy", not "how fast is it for you".
