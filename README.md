# adhikrish.cloud

everything under `*.adhikrish.cloud`, in one repo.

- `public/` - [adhikrish.cloud](https://adhikrish.cloud), a static site on cloudflare pages.
- `private/admin/` - admin.adhikrish.cloud, a cloudflare worker that links every service, probes each one every five minutes and shows its uptime, so it still works when the server is off.
- `private/snrintern/` - snrintern.adhikrish.cloud, a cloudflare worker + d1 api and page for my personal agent's data.
- `private/infra/` - the thinkpad's compose files, backup and tuning scripts, configs and runbooks.
- `design/` - the css and page shell every site shares.
- `services.json` - the one list of services.

how it all works, including what happens on a reboot and when each path in fails: [adhikrish.cloud/src/adhikrish-cloud](https://adhikrish.cloud/src/adhikrish-cloud).

agents: start with [`AGENTS.md`](AGENTS.md).
