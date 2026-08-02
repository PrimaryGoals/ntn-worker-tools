# ntn command tree

Full inventory of `ntn` subcommands, discovered by recursively invoking `ntn help`. Each leaf shows the command's full Usage line. Aliases, the auto-generated `help` command, and interactive commands (e.g. `ntn workers tui`) are omitted per project convention.

Regenerate with `node scripts/walk-ntn-help.mjs` — paste the output between the ``` fences below and bump the "Captured against …" date.

Captured against ntn version installed on `2026-07-31`.

```
ntn
-- api
---- ls : ntn api ls [OPTIONS]
-- datasources
---- query : ntn datasources query [OPTIONS] <DATA_SOURCE_ID>
---- resolve : ntn datasources resolve [OPTIONS] <ID>
-- files
---- create : ntn files create [OPTIONS]
---- get : ntn files get [OPTIONS] <UPLOAD_ID>
---- list : ntn files list [OPTIONS]
-- pages
---- trash : ntn pages trash [OPTIONS] <PAGE_ID>
---- get : ntn pages get [OPTIONS] <PAGE_ID>
---- create : ntn pages create [OPTIONS]
---- edit : ntn pages edit [OPTIONS] <PAGE_ID>
-- login : ntn login [OPTIONS]
-- logout : ntn logout [OPTIONS]
-- whoami : ntn whoami [OPTIONS]
-- completions : ntn completions [OPTIONS] <SHELL>
-- doctor : ntn doctor [OPTIONS]
-- update : ntn update [OPTIONS]
-- workers
---- capabilities
------ list : ntn workers capabilities list [OPTIONS] [WORKER_ID]
---- create : ntn workers create [OPTIONS]
---- delete : ntn workers delete [OPTIONS] [WORKER_ID]
---- deploy : ntn workers deploy [OPTIONS]
---- new : ntn workers new [OPTIONS] [DIRECTORY]
---- env
------ set : ntn workers env set [OPTIONS] <VARS>...
------ list : ntn workers env list [OPTIONS] [WORKER_ID]
------ unset : ntn workers env unset [OPTIONS] <KEY>
------ pull : ntn workers env pull [OPTIONS] [WORKER_ID]
------ push : ntn workers env push [OPTIONS] [WORKER_ID]
---- exec : ntn workers exec [OPTIONS] <KEY>
---- get : ntn workers get [OPTIONS] [WORKER_ID]
---- oauth
------ show-redirect-url : ntn workers oauth show-redirect-url [OPTIONS]
------ start : ntn workers oauth start [OPTIONS] <KEY>
------ token : ntn workers oauth token [OPTIONS] <KEY>
---- rename : ntn workers rename [OPTIONS] <NAME>
---- list : ntn workers list [OPTIONS]
---- runs
------ list : ntn workers runs list [OPTIONS] [WORKER_ID]
------ logs : ntn workers runs logs [OPTIONS] <RUN_ID>
---- sync
------ pause : ntn workers sync pause [OPTIONS] <KEY>
------ resume : ntn workers sync resume [OPTIONS] <KEY>
------ trigger : ntn workers sync trigger [OPTIONS] <KEY>
------ state
-------- get : ntn workers sync state get [OPTIONS] <KEY>
-------- reset : ntn workers sync state reset [OPTIONS] <KEY>
------ status : ntn workers sync status [OPTIONS] [CAPABILITY_KEY]
---- usage : ntn workers usage [OPTIONS] [WORKER_ID]
---- webhooks
------ list : ntn workers webhooks list [OPTIONS] [WORKER_ID]
```

## Quick observations for UI planning

- 41 leaf commands across 6 top-level areas: `api`, `datasources`, `files`, `pages`, `workers`, plus a handful of session/utility commands (`login`, `logout`, `whoami`, `doctor`, `update`, `completions`).
- The current UI covers 4 of the 41 (`whoami`, `workers list`, `workers runs list`, `workers runs logs`).
- Only two commands go 4 levels deep: `workers sync state get` and `workers sync state reset`.
- Destructive commands worth calling out for later UI treatment (confirmation dialogs): `pages trash`, `workers delete`, `workers env unset`, `workers sync state reset`.
- `workers exec`, `workers sync trigger`, and `workers oauth start` are user-initiated *actions* rather than read-only inspections — they'll shape a different kind of panel than the browse views we've built so far.
