# homeserver

an old thinkpad t480, running as a server since dec 2024, so photos, files, notes and long-running agents live on hardware i own. it sits in singapore and i work from palo alto, so two constraints drive everything: nothing exposed to the internet, and as few round trips across the pacific as possible. it runs the photo library, file storage, music, dns, backups, notes, and the claude code and codex sessions that run for hours.

## the machine

an i5-8350U with 4 cores, about 24 GB of ram (about 3 GB in use), a 477 GB nvme drive and ubuntu 24.04. a laptop is a good server for this: low idle power, no fan noise, and the battery covers short power cuts. charge is held at 75-80%, because a battery kept at 100% for years wears out and swells.

## no open ports

no ports are forwarded on the router, and my home ip isn't in dns. instead, `cloudflared` keeps an outbound tunnel open to cloudflare. cloudflare handles https and checks who's allowed in, and nginx proxy manager sends each hostname to the right app.

<figure class="diagram">
<svg viewBox="0 0 600 232" role="img" aria-label="two independent paths in: public names through cloudflare and a tunnel to nginx proxy manager and per-app docker networks, private services only over tailscale between server, mac and phone">
<defs><marker id="home-a1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<text class="d-s" x="4" y="16" text-anchor="start">public names, through the cloudflare tunnel</text>
<rect class="d-box" x="4" y="26" width="110" height="50" rx="4"/><text class="d-t" x="59" y="48" text-anchor="middle">cloudflare</text><text class="d-s" x="59" y="65" text-anchor="middle">https + access</text>
<rect class="d-box" x="142" y="26" width="110" height="50" rx="4"/><text class="d-t" x="197" y="48" text-anchor="middle">cloudflared</text><text class="d-s" x="197" y="65" text-anchor="middle">outbound tunnel</text>
<rect class="d-box" x="280" y="26" width="160" height="50" rx="4"/><text class="d-t" x="360" y="48" text-anchor="middle">nginx proxy manager</text><text class="d-s" x="360" y="65" text-anchor="middle">routes by hostname</text>
<rect class="d-box" x="468" y="26" width="128" height="50" rx="4"/><text class="d-t" x="532" y="48" text-anchor="middle">docker networks</text><text class="d-s" x="532" y="65" text-anchor="middle">one per app</text>
<line class="d-line" x1="114" y1="51" x2="140" y2="51" marker-end="url(#home-a1)"/>
<line class="d-line" x1="252" y1="51" x2="278" y2="51" marker-end="url(#home-a1)"/>
<line class="d-line" x1="440" y1="51" x2="466" y2="51" marker-end="url(#home-a1)"/>
<text class="d-s" x="4" y="108" text-anchor="start">private services, only over tailscale or the home network</text>
<rect class="d-store" x="4" y="118" width="592" height="100" rx="14"/>
<rect class="d-box" x="30" y="143" width="110" height="50" rx="4"/><text class="d-t" x="85" y="172.5" text-anchor="middle">mac</text>
<rect class="d-box" x="240" y="143" width="120" height="50" rx="4"/><text class="d-t" x="300" y="165" text-anchor="middle">server</text><text class="d-s" x="300" y="182" text-anchor="middle">samba, navidrome</text>
<rect class="d-box" x="460" y="143" width="110" height="50" rx="4"/><text class="d-t" x="515" y="172.5" text-anchor="middle">phone</text>
<line class="d-line" x1="140" y1="168" x2="238" y2="168" marker-end="url(#home-a1)"/>
<line class="d-line" x1="460" y1="168" x2="362" y2="168" marker-end="url(#home-a1)"/>
<text class="d-s" x="300" y="208" text-anchor="middle">tailnet of three devices</text>
</svg>
<figcaption>two paths in, and they fail independently. a cloudflare outage doesn't lock me out of the tailnet.</figcaption>
</figure>

one wildcard dns record points every subdomain at the tunnel, so adding a service is a compose file and a proxy entry, with no dns change. each app gets its own docker network, and only the proxy is attached to all of them.

anything that shouldn't have a public name goes over tailscale instead. file sharing (samba) and music (navidrome) are only reachable on my home network or my tailnet of three devices: the server, my mac and my phone. the two paths fail independently, so a cloudflare outage doesn't lock me out.

## latency

before tuning anything, i timed a request from palo alto (in march, over about 13,600 km of fibre):

<figure class="diagram">
<svg viewBox="0 0 600 172" role="img" aria-label="a request from palo alto: tcp connect 110 ms, tls 146 ms, first byte 182 ms, of which the server takes about 30 ms">
<defs><marker id="home-a2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
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

the server itself only takes about 30 ms. the rest is distance, so the only lever is fewer round trips. i switched to bbr congestion control, turned on tcp fast open, stopped idle connections from restarting slowly, set keepalives to about a minute, enabled http/2 everywhere and turned on gzip. the numbers and configs are in [`docs/latency.md`](docs/latency.md).

dns goes through adguard home, which blocks trackers and caches answers. a fresh lookup took about 123 ms, a cached one about 3 ms.

## reliability and backups

- every container restarts on its own after a crash or reboot.
- the tunnel only starts once the proxy reports healthy.
- the photo database (immich's postgres) is pinned to an exact image and stores data checksums, so upgrades are deliberate and corruption gets caught.
- uptime kuma checks each app directly and through the proxy, so i can tell a broken proxy from a broken app.
- security patches install automatically.

backups run every night. at 01:30 a script collects every config, at 02:00 restic copies everything to backblaze b2, and at 03:00 old snapshots are pruned, keeping 30 daily and 12 monthly, with an integrity check once a month. the backup password lives outside the backup, since a password only stored inside the backup can't unlock it. [`scripts/backup_configs.sh`](scripts/backup_configs.sh)

<figure class="diagram">
<svg viewBox="0 0 600 160" role="img" aria-label="nightly backups: 01:30 collect configs, 02:00 restic to backblaze b2, 03:00 prune old snapshots">
<defs><marker id="home-a3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<line class="d-line" x1="10" y1="34" x2="590" y2="34" marker-end="url(#home-a3)"/>
<text class="d-t" x="100" y="22" text-anchor="middle">01:30</text>
<text class="d-t" x="300" y="22" text-anchor="middle">02:00</text>
<text class="d-t" x="500" y="22" text-anchor="middle">03:00</text>
<line class="d-line" x1="100" y1="36" x2="100" y2="58" marker-end="url(#home-a3)"/>
<line class="d-line" x1="300" y1="36" x2="300" y2="58" marker-end="url(#home-a3)"/>
<line class="d-line" x1="500" y1="36" x2="500" y2="58" marker-end="url(#home-a3)"/>
<rect class="d-box" x="5" y="60" width="190" height="64" rx="4"/><text class="d-t" x="100" y="82" text-anchor="middle">collect configs</text><text class="d-s d-mono" x="100" y="99" text-anchor="middle">scripts/backup_configs.sh</text>
<rect class="d-box" x="210" y="60" width="180" height="64" rx="4"/><text class="d-t" x="300" y="82" text-anchor="middle">restic</text><text class="d-s" x="300" y="99" text-anchor="middle">copies everything to</text><text class="d-s" x="300" y="113" text-anchor="middle">backblaze b2</text>
<rect class="d-box" x="405" y="60" width="190" height="64" rx="4"/><text class="d-t" x="500" y="82" text-anchor="middle">prune snapshots</text><text class="d-s" x="500" y="99" text-anchor="middle">keep 30 daily, 12 monthly</text><text class="d-s" x="500" y="113" text-anchor="middle">integrity check monthly</text>
<text class="d-s" x="300" y="150" text-anchor="middle">the backup password lives outside the backup</text>
</svg>
<figcaption>the nightly backup, in order. times are evenly spaced here, not to scale.</figcaption>
</figure>

## notes and agents

my notes are obsidian vaults, stored as plain markdown on google drive and mounted on the server, so every machine and every agent reads the same files. claude code and codex share one instruction file and one set of skills, so one edit updates both agents everywhere.

the agents run on the server, inside tmux sessions that start at boot. a multi-hour task keeps going with my laptop closed. i attach from my mac over tailscale (about 190 ms), and only my keystrokes cross the pacific. running many sessions side by side led to two tools: [agent-squad](https://github.com/adhikrysh/agent-squad), which shows which sessions are waiting on me, and [ghostty-agent-workspace](https://github.com/adhikrysh/ghostty-agent-workspace), a scripted terminal layout for working next to them.

<figure class="diagram">
<svg viewBox="0 0 600 145" role="img" aria-label="agents run on the server in singapore inside tmux sessions; the mac in palo alto attaches over tailscale at about 190 ms and only keystrokes cross">
<defs><marker id="home-a4" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>
<rect class="d-box" x="10" y="45" width="120" height="50" rx="4"/><text class="d-t" x="70" y="67" text-anchor="middle">mac</text><text class="d-s" x="70" y="84" text-anchor="middle">palo alto</text>
<text class="d-s" x="209" y="62" text-anchor="middle">tailscale, about 190 ms</text>
<line class="d-line" x1="130" y1="70" x2="288" y2="70" marker-end="url(#home-a4)"/>
<text class="d-s" x="209" y="90" text-anchor="middle">only keystrokes cross</text>
<rect class="d-store" x="290" y="10" width="300" height="120" rx="14"/>
<text class="d-t" x="440" y="32" text-anchor="middle">server, singapore</text>
<text class="d-s" x="440" y="50" text-anchor="middle">tmux sessions, started at boot</text>
<rect class="d-box" x="306" y="64" width="128" height="50" rx="4"/><text class="d-t" x="370" y="93.5" text-anchor="middle">claude code</text>
<rect class="d-box" x="446" y="64" width="128" height="50" rx="4"/><text class="d-t" x="510" y="93.5" text-anchor="middle">codex</text>
</svg>
<figcaption>where the agents live. they keep running on the server, and my mac only attaches to them.</figcaption>
</figure>

the configs and scripts are in this repo, with secrets removed.
