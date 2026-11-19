# *.adhikrish.cloud

everything i self-host lives under one domain now: this site, an uptime dashboard, the api my personal agent writes to, and the photos, files and backups that run on an old thinkpad t480 in singapore. i work from palo alto, so two constraints drive every decision: nothing on the box is exposed to the internet, and every round trip across the pacific costs about 110 ms. the interesting part isn't the happy path. it's what happens when the power cuts out, the box reboots, or a path in breaks.

## what runs where

the split is simple. anything that has to keep working when the thinkpad is off runs on cloudflare, and that now includes my agent's data. the thinkpad keeps what needs a big local disk: photos, files and their backups. everything on cloudflare fits inside the free plan.

<figure class="diagram">
<svg viewBox="0 0 600 300" role="img" aria-label="cloudflare runs the public site on pages, the uptime dashboard and senior intern as workers with a d1 database, the access login and the tunnel endpoint; the thinkpad runs nginx proxy manager and the self-hosted apps">
<defs><marker id="cloud-a1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<rect class="d-store" x="4" y="4" width="592" height="122" rx="14"/>
<text class="d-t" x="20" y="28" text-anchor="start">cloudflare, keeps working when the thinkpad is off</text>
<rect class="d-box" x="20" y="44" width="130" height="64" rx="4"/><text class="d-t" x="85" y="68" text-anchor="middle">pages</text><text class="d-s" x="85" y="86" text-anchor="middle">adhikrish.cloud</text><text class="d-s" x="85" y="100" text-anchor="middle">public, no login</text>
<rect class="d-box" x="164" y="44" width="130" height="64" rx="4"/><text class="d-t" x="229" y="68" text-anchor="middle">workers + d1</text><text class="d-s" x="229" y="86" text-anchor="middle">uptime.</text><text class="d-s" x="229" y="100" text-anchor="middle">seniorintern.</text>
<rect class="d-box" x="308" y="44" width="130" height="64" rx="4"/><text class="d-t" x="373" y="68" text-anchor="middle">access</text><text class="d-s" x="373" y="86" text-anchor="middle">login for people,</text><text class="d-s" x="373" y="100" text-anchor="middle">tokens for machines</text>
<rect class="d-box" x="452" y="44" width="130" height="64" rx="4"/><text class="d-t" x="517" y="68" text-anchor="middle">tunnel</text><text class="d-s" x="517" y="86" text-anchor="middle">*.adhikrish.cloud</text><text class="d-s" x="517" y="100" text-anchor="middle">health alert by email</text>
<line class="d-line" x1="438" y1="76" x2="450" y2="76" marker-end="url(#cloud-a1)"/>
<line class="d-line" x1="517" y1="166" x2="517" y2="110" marker-end="url(#cloud-a1)"/>
<text class="d-s" x="511" y="142" text-anchor="end">outbound, opened by the thinkpad</text>
<rect class="d-store" x="4" y="168" width="592" height="126" rx="14"/>
<text class="d-t" x="20" y="192" text-anchor="start">thinkpad, needs a real disk</text>
<rect class="d-box" x="452" y="206" width="130" height="64" rx="4"/><text class="d-t" x="517" y="230" text-anchor="middle">cloudflared</text><text class="d-s" x="517" y="248" text-anchor="middle">container</text>
<rect class="d-box" x="300" y="206" width="138" height="64" rx="4"/><text class="d-t" x="369" y="230" text-anchor="middle">proxy manager</text><text class="d-s" x="369" y="248" text-anchor="middle">routes by hostname</text>
<rect class="d-box" x="20" y="206" width="266" height="64" rx="4"/><text class="d-t" x="153" y="230" text-anchor="middle">apps</text><text class="d-s" x="153" y="248" text-anchor="middle">immich, files, backrest,</text><text class="d-s" x="153" y="262" text-anchor="middle">beszel, adguard</text>
<line class="d-line" x1="452" y1="238" x2="440" y2="238" marker-end="url(#cloud-a1)"/>
<line class="d-line" x1="300" y1="238" x2="288" y2="238" marker-end="url(#cloud-a1)"/>
</svg>
<figcaption>schematic. the bottom row only exists while the thinkpad is on; the top row doesn't care.</figcaption>
</figure>

all of it is one repo, [adhikrysh/adhikrish.cloud](https://github.com/adhikrysh/adhikrish.cloud). `public/` is this site, `private/` is the uptime worker, senior intern and the server's compose files, and `design/` is the css both halves share. ci deploys each piece only when its own files change.

## no open ports

no port is forwarded on the router and my home ip isn't in dns. `cloudflared` runs as a container on the thinkpad and keeps an outbound tunnel open to cloudflare, and cloudflare pushes requests down it. one wildcard record sends every subdomain to the tunnel, so adding an app is a compose file and a proxy entry, with no dns change.

before a request reaches the tunnel, cloudflare access checks who's asking. people log in with google, and nothing else. machines carry a service token: the immich app on my phone has one, and the uptime dashboard's prober gets its own. a wildcard app locks every subdomain by default, and a service gets its own app only when one extra visitor, like that phone, needs into it and nothing else. access never merges apps: the most specific name wins, so each of those apps repeats the full guest list. [`docs/access.md`](https://github.com/adhikrysh/adhikrish.cloud/blob/main/docs/access.md) walks through it. each app gets its own docker network, and only the proxy is attached to all of them, so a compromised app can't talk to its neighbours.

<figure class="diagram">
<svg viewBox="0 0 600 232" role="img" aria-label="two independent paths in: public names through cloudflare and a tunnel to nginx proxy manager and per-app docker networks, private services only over tailscale between server, mac and phone">
<defs><marker id="cloud-a2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<text class="d-s" x="4" y="16" text-anchor="start">public names, through the cloudflare tunnel</text>
<rect class="d-box" x="4" y="26" width="110" height="50" rx="4"/><text class="d-t" x="59" y="48" text-anchor="middle">cloudflare</text><text class="d-s" x="59" y="65" text-anchor="middle">https + access</text>
<rect class="d-box" x="142" y="26" width="110" height="50" rx="4"/><text class="d-t" x="197" y="48" text-anchor="middle">cloudflared</text><text class="d-s" x="197" y="65" text-anchor="middle">outbound tunnel</text>
<rect class="d-box" x="280" y="26" width="160" height="50" rx="4"/><text class="d-t" x="360" y="48" text-anchor="middle">nginx proxy manager</text><text class="d-s" x="360" y="65" text-anchor="middle">routes by hostname</text>
<rect class="d-box" x="468" y="26" width="128" height="50" rx="4"/><text class="d-t" x="532" y="48" text-anchor="middle">docker networks</text><text class="d-s" x="532" y="65" text-anchor="middle">one per app</text>
<line class="d-line" x1="114" y1="51" x2="140" y2="51" marker-end="url(#cloud-a2)"/>
<line class="d-line" x1="252" y1="51" x2="278" y2="51" marker-end="url(#cloud-a2)"/>
<line class="d-line" x1="440" y1="51" x2="466" y2="51" marker-end="url(#cloud-a2)"/>
<text class="d-s" x="4" y="108" text-anchor="start">private services, only over tailscale or the home network</text>
<rect class="d-store" x="4" y="118" width="592" height="100" rx="14"/>
<rect class="d-box" x="30" y="143" width="110" height="50" rx="4"/><text class="d-t" x="85" y="172.5" text-anchor="middle">mac</text>
<rect class="d-box" x="240" y="143" width="120" height="50" rx="4"/><text class="d-t" x="300" y="165" text-anchor="middle">server</text><text class="d-s" x="300" y="182" text-anchor="middle">samba, ssh</text>
<rect class="d-box" x="460" y="143" width="110" height="50" rx="4"/><text class="d-t" x="515" y="172.5" text-anchor="middle">phone</text>
<line class="d-line" x1="140" y1="168" x2="238" y2="168" marker-end="url(#cloud-a2)"/>
<line class="d-line" x1="460" y1="168" x2="362" y2="168" marker-end="url(#cloud-a2)"/>
<text class="d-s" x="300" y="208" text-anchor="middle">tailnet of three devices</text>
</svg>
<figcaption>two paths in. they depend on different companies and different software, so one failing doesn't take the other down.</figcaption>
</figure>

anything that shouldn't have a public name, like the samba file share and ssh, goes over tailscale instead: a tailnet of three devices (the server, my mac and my phone), with a direct wireguard path from the mac.

## the machine and its power

an i5-8350U with 4 cores, about 24 GB of ram (about 3 GB in use), a 477 GB nvme drive and ubuntu 24.04. a laptop makes a decent small server: low idle power, no fan noise, and a battery that acts as a built-in ups for short power cuts. charge is held at 75-80%, because a lithium cell kept at 100% for years wears out and swells.

the battery only buys time, though. if the power stays off long enough to drain it, the laptop shuts down, and turning back on when power returns is the job of a bios setting, not of anything on the disk.

## what happens on a reboot

a reboot is where the setup gets tested, because nobody is there to type commands. here's the chain.

<figure class="diagram">
<svg viewBox="0 0 600 222" role="img" aria-label="boot chain: power on, linux, docker starts every container by restart policy, cloudflared reconnects the tunnel, user services start through lingering, tailscale rejoins the tailnet">
<defs><marker id="cloud-a3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<rect class="d-box" x="4" y="10" width="140" height="50" rx="4"/><text class="d-t" x="74" y="32" text-anchor="middle">power on</text><text class="d-s" x="74" y="49" text-anchor="middle">bios, when ac returns</text>
<line class="d-line" x1="144" y1="35" x2="168" y2="35" marker-end="url(#cloud-a3)"/>
<rect class="d-box" x="170" y="10" width="120" height="50" rx="4"/><text class="d-t" x="230" y="32" text-anchor="middle">ubuntu boots</text><text class="d-s" x="230" y="49" text-anchor="middle">sysctl tuning loads</text>
<line class="d-line" x1="290" y1="35" x2="314" y2="35" marker-end="url(#cloud-a3)"/>
<rect class="d-box" x="316" y="10" width="280" height="50" rx="4"/><text class="d-t" x="456" y="32" text-anchor="middle">docker starts every container</text><text class="d-s" x="456" y="49" text-anchor="middle">restart: always or unless-stopped</text>
<line class="d-line" x1="456" y1="60" x2="456" y2="84" marker-end="url(#cloud-a3)"/>
<rect class="d-box" x="316" y="86" width="280" height="50" rx="4"/><text class="d-t" x="456" y="108" text-anchor="middle">cloudflared reconnects the tunnel</text><text class="d-s" x="456" y="125" text-anchor="middle">502s until the proxy is up</text>
<line class="d-line" x1="230" y1="60" x2="230" y2="160" marker-end="url(#cloud-a3)"/>
<rect class="d-box" x="100" y="162" width="260" height="50" rx="4"/><text class="d-t" x="230" y="184" text-anchor="middle">tailscaled rejoins the tailnet</text><text class="d-s" x="230" y="201" text-anchor="middle">saved identity</text>
<rect class="d-box" x="376" y="162" width="220" height="50" rx="4"/><text class="d-t" x="486" y="184" text-anchor="middle">user services</text><text class="d-s" x="486" y="201" text-anchor="middle">started by lingering</text>
<line class="d-line" x1="360" y1="187" x2="374" y2="187"/>
</svg>
<figcaption>schematic of a cold boot. docker and tailscale start on their own; the tunnel is back as soon as its container is.</figcaption>
</figure>

- **containers.** every container has `restart: always` (the immich stack) or `unless-stopped` (everything else), so docker brings them all back after a crash or a reboot. that's in the compose files. the difference matters only if i stop something by hand: `unless-stopped` stays stopped, `always` comes back.
- **tunnel ordering.** the tunnel's compose file says it waits for the proxy's healthcheck. that's only true on `docker compose up`. on a cold boot docker restarts containers by policy and ignores health conditions, so the tunnel can come up first and return 502s for a few seconds until the proxy answers. harmless, but it's not the guarantee the compose file suggests.
- **the photo database.** immich's postgres is pinned to an exact image digest and stores data checksums, so an upgrade only happens when i change the digest, and corruption from an unclean power cut gets reported instead of silently served.
- **network tuning.** the tcp settings live in `/etc/sysctl.d/`, so they load on every boot.
- **dns.** adguard binds port 53 on the host. ubuntu's own resolver can also want that port, and if it grabs it first after a reboot, adguard can't start. the router hands out a public resolver as the second dns server, so a dead adguard should mean ads come back, not that the house loses internet.
- **tailscale.** `tailscaled` is a system service that starts at boot and rejoins with its saved identity. the catch is node key expiry: tailscale expires a device's key after 180 days unless you turn that off, and when it expires the device drops off the tailnet without any error on the server. on a server that runs unattended, expiry has to be off.
- **automatic updates.** unattended-upgrades installs security patches.

## when something fails

the two paths in are there so a single failure doesn't lock me out. this is what keeps working in each case, following from the compose files and the port list.

| what fails | still works | lost |
|---|---|---|
| cloudflare, or the tunnel container | ssh and samba over tailscale; everything on the home network | every `*.adhikrish.cloud` name, the immich phone app |
| tailscale on the server (or an expired key) | every app through cloudflare | ssh, samba |
| the thinkpad itself | this site, senior intern, and the uptime page, which then shows every app red | every self-hosted app |
| home internet | everything, but only from inside the house | both paths, since both dial out |

the last two rows are why the uptime dashboard and this site don't run on the thinkpad.

## watching it

the old setup watched itself from the inside: uptime kuma and beszel ran on the thinkpad, so when the thinkpad died, so did the thing that was supposed to notice. now there are two layers that live on cloudflare instead.

- **the tunnel health alert.** cloudflare emails me when the tunnel's health changes. a dead box means a dead tunnel, so this catches the worst case with no code at all. it's included in the free zero trust plan.
- **uptime.adhikrish.cloud.** a public page, linked from the home page next to github. a worker requests each app through access and the tunnel, in parallel, every five minutes, and the page only reads what it stored, so a visit never touches the thinkpad. it shows whether each one answered and how fast, plus its last 24 hours and its uptime over 30 days, kept in a d1 database. it tells apart an app that's down (a 5xx from the proxy), a tunnel that's down (cloudflare's 530), and a probe that access refused.

the tunnel alert covers the whole box; the uptime page covers each app on its own. beszel keeps cpu, memory, disk and temperature history on the box.

## senior intern

senior intern is the data store for my personal agent (an openai dot). it holds people i've met, forecasts i want to be scored on, training sessions and weigh-ins: four tables in a cloudflare d1 database. it started as a google sheet. the agent writes to it with plain http calls, and i read it as a minimal page with a tab per table.

it's a worker, so it stays up when the thinkpad doesn't, and it costs nothing: the free plan allows 100,000 requests and 100,000 row writes a day, and the whole dataset is a few dozen rows. access sits in front of it. the agent carries its own service token, and the worker still checks the signed jwt that access attaches to every request it lets through, which is also how every row records who wrote it last. the api is generic over tables: `GET /api` lists every tab with its fields, so adding a tab is a schema change the agent discovers on its own, not a new endpoint. backups come from d1 itself, which can restore the database to any minute in the last 30 days.

## latency

before tuning anything, i timed a request from palo alto (in march, over about 13,600 km of fibre):

<figure class="diagram">
<svg viewBox="0 0 600 172" role="img" aria-label="a request from palo alto: tcp connect 110 ms, tls 146 ms, first byte 182 ms, of which the server takes about 30 ms">
<text class="d-s" x="110" y="30" text-anchor="end">tcp connect</text>
<rect class="d-box" x="120" y="14" width="242" height="24" rx="3"/>
<text class="d-s" x="370" y="30" text-anchor="start">110 ms</text>
<text class="d-s" x="110" y="70" text-anchor="end">tls</text>
<rect class="d-box" x="120" y="54" width="321" height="24" rx="3"/>
<text class="d-s" x="449" y="70" text-anchor="start">146 ms</text>
<text class="d-s" x="110" y="110" text-anchor="end">first byte</text>
<rect class="d-box" x="120" y="94" width="400" height="24" rx="3"/>
<text class="d-s" x="528" y="110" text-anchor="start">182 ms</text>
<text class="d-s" x="110" y="150" text-anchor="end">server time</text>
<rect class="d-warn" x="120" y="134" width="66" height="24" rx="3"/>
<text class="d-s" x="194" y="150" text-anchor="start">about 30 ms</text>
<line class="d-line" x1="120" y1="6" x2="120" y2="164"/>
</svg>
<figcaption>the same request, to scale. the server's own 30 ms is a small slice of the 182 ms before the first byte arrives, so the rest is distance.</figcaption>
</figure>

light in fibre needs about 68 ms each way over that distance, so no server tuning gets close to fixing this. the only lever is fewer round trips: bbr congestion control, tcp fast open, no slow start after idle connections, http/2 on every proxy host and gzip. keepalives detect a dead connection within about two minutes (60 seconds idle, then up to six probes 10 seconds apart). the configs and the measurement method are in [`docs/latency.md`](https://github.com/adhikrysh/adhikrish.cloud/blob/main/docs/latency.md). those settings only help connections that end on the box, like the tailnet. a visitor's tcp connection ends at cloudflare, and the tunnel itself runs over quic.

dns goes through adguard home, which blocks trackers and caches answers: about 123 ms for a fresh lookup, about 3 ms cached.

## backups

every night at 01:30 a script collects every app's config into the data share: a `pg_dumpall` of the photo database, adguard's root-only config read through `docker exec`, an online sqlite backup of beszel, and every compose file and `.env`. at 02:00 restic, driven by backrest, copies the whole data share to backblaze b2, encrypted. at 03:00 old snapshots are pruned (30 daily and 12 monthly), with an integrity check once a month. the script is [`private/infra/scripts/backup_configs.sh`](https://github.com/adhikrysh/adhikrish.cloud/blob/main/private/infra/scripts/backup_configs.sh).

<figure class="diagram">
<svg viewBox="0 0 600 160" role="img" aria-label="nightly backups: 01:30 collect configs, 02:00 restic to backblaze b2, 03:00 prune old snapshots">
<defs><marker id="cloud-a4" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<line class="d-line" x1="10" y1="34" x2="590" y2="34" marker-end="url(#cloud-a4)"/>
<text class="d-t" x="100" y="22" text-anchor="middle">01:30</text>
<text class="d-t" x="300" y="22" text-anchor="middle">02:00</text>
<text class="d-t" x="500" y="22" text-anchor="middle">03:00</text>
<line class="d-line" x1="100" y1="36" x2="100" y2="58" marker-end="url(#cloud-a4)"/>
<line class="d-line" x1="300" y1="36" x2="300" y2="58" marker-end="url(#cloud-a4)"/>
<line class="d-line" x1="500" y1="36" x2="500" y2="58" marker-end="url(#cloud-a4)"/>
<rect class="d-box" x="5" y="60" width="190" height="64" rx="4"/><text class="d-t" x="100" y="82" text-anchor="middle">collect configs</text><text class="d-s d-mono" x="100" y="99" text-anchor="middle">backup_configs.sh</text>
<rect class="d-box" x="210" y="60" width="180" height="64" rx="4"/><text class="d-t" x="300" y="82" text-anchor="middle">restic</text><text class="d-s" x="300" y="99" text-anchor="middle">copies everything to</text><text class="d-s" x="300" y="113" text-anchor="middle">backblaze b2</text>
<rect class="d-box" x="405" y="60" width="190" height="64" rx="4"/><text class="d-t" x="500" y="82" text-anchor="middle">prune snapshots</text><text class="d-s" x="500" y="99" text-anchor="middle">keep 30 daily, 12 monthly</text><text class="d-s" x="500" y="113" text-anchor="middle">integrity check monthly</text>
<text class="d-s" x="300" y="150" text-anchor="middle">the backup password lives outside the backup</text>
</svg>
<figcaption>the nightly backup, in order. times are evenly spaced here, not to scale.</figcaption>
</figure>

two things are deliberately left out: tls certificates (cloudflare issues them) and caches that rebuild themselves. the restic password and the b2 keys live in my password manager, outside the backup, since a password stored only inside the backup can't unlock it.
