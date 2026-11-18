# infra: the thinkpad

a 2018 thinkpad t480 (i5-8350U, ~24 GB ram, 477 GB nvme, ubuntu 24.04) in singapore that runs the self-hosted apps of `*.adhikrish.cloud`. it has no open ports: it dials out to cloudflare through a tunnel, and every visitor passes cloudflare access first. the whole story, including restart handling and failure modes, is the write-up at [adhikrish.cloud/src/adhikrish-cloud](https://adhikrish.cloud/src/adhikrish-cloud). this folder used to be the `adhikrysh/homeserver` repo.

```text
browser / agent
  -> cloudflare edge          tls + access (people: login, machines: service tokens)
  -> outbound tunnel          opened by the server; no inbound ports
  -> nginx proxy manager      routes by hostname
  -> one docker network per app
       immich · filebrowser · backrest · beszel · adguard · uptime kuma

nightly (utc)
  01:30  config bundle (pg_dumpall, root-only configs via docker exec, sqlite online backup)
  02:00  restic via backrest -> backblaze b2, encrypted
  03:00  prune; monthly integrity check
```

| path | what |
|---|---|
| [`compose/`](compose/) | the compose file of every running service; secrets live in per-app `.env` files on the box, never here |
| [`scripts/backup_configs.sh`](scripts/backup_configs.sh) | the nightly config bundle that restic then ships to b2 |
| [`scripts/apply-tcp-tuning.sh`](scripts/apply-tcp-tuning.sh) | installs [`config/sysctl/99-network-latency.conf`](config/sysctl/99-network-latency.conf) |
| [`config/nginx/custom-http.conf`](config/nginx/custom-http.conf) | gzip for nginx proxy manager |
| [`config/systemd-user/second-brain-drive.service`](config/systemd-user/second-brain-drive.service) | rclone mount of the obsidian vaults on google drive |
| [`docs/add-a-service.md`](docs/add-a-service.md) | the runbook for adding an app behind the tunnel |
| [`docs/latency.md`](docs/latency.md) | measuring each request phase before tuning anything |

admin and snrintern don't run here: they're cloudflare workers in [`../admin/`](../admin/) and [`../snrintern/`](../snrintern/), so they keep working when this box is off.

## not verified on the box yet

these are the claims the restart and failover story depends on that nobody has checked. run them the next time the server is up:

- bios: power on after ac loss is enabled.
- `loginctl show-user drc -p Linger` says `yes`, and `systemctl --user list-unit-files --state=enabled` lists the user units.
- `systemctl is-enabled docker tailscaled` says `enabled` for both.
- tailscale admin console: key expiry is disabled for this node.
- `/etc/apt/apt.conf.d/50unattended-upgrades`: what `Unattended-Upgrade::Automatic-Reboot` is set to.
- `sysctl net.ipv4.tcp_congestion_control` says `bbr` (the tuning survived the 2026-10-07 cleanup).
- adguard owns port 53 after a reboot (`ss -lunp 'sport = :53'`), and the router hands out a second dns server.
- a restore from b2 onto a blank machine, timed.
- the outages: `journalctl --list-boots`, `journalctl -b -1 -e`, `/var/log/unattended-upgrades/`.

## what is deliberately not here

secrets, addresses and anything personal stored on the server. navidrome and the tmux/agent units were retired in november 2026 and stay only in the archived homeserver repo.
