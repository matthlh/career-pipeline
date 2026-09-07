# Getting the schedule to actually run on macOS

The pipeline is six cron entries. As of 7 Sept 2026 none of them has ever
completed, and the reason is not the pipeline.

## What is happening

macOS puts `~/Documents`, `~/Desktop` and `~/Downloads` behind TCC, the same
permission system that guards the camera. A background job cannot read a file in
there unless the binary doing the reading has been granted **Full Disk Access**.

The failure is silent in a specific, nasty way. First it fails so early that
nothing is written at all — no log, no error, no mail — because every crontab
line is `cd <repo> && python3 ...` and a `cd` that fails short-circuits the `&&`.
Grant Full Disk Access to `/usr/sbin/cron` and you get one step further: the `cd`
works, cron writes a log, and every line of it says

```
python3: can't open file 'scripts/run.py': [Errno 1] Operation not permitted
```

because the process that now needs the grant is **the python binary**, not cron.
`scripts/cronhealth.py` detects both states and `run.py check` prints it.

## Three ways out, worst to best

### 1. Grant Full Disk Access to python as well

System Settings → Privacy & Security → Full Disk Access → **+** → press
`Cmd-Shift-G` and paste the interpreter the crontab actually names:

```
/Library/Developer/CommandLineTools/usr/bin/python3
```

Works, but it is a broad grant to a general-purpose interpreter, and it breaks
again the day Xcode's command line tools update and replace that binary.

### 2. Move the repo out of a protected folder

```bash
mv ~/Documents/CodingProjects ~/CodingProjects
```

TCC does not guard `~/CodingProjects`, so nothing needs a grant at all and it
keeps working across OS updates. Cheapest permanent fix, and it costs you a
`cd` in muscle memory plus updating the crontab paths.

### 3. Use launchd instead of cron

cron is a compatibility shim on macOS. `launchd` is the supported mechanism, and
a **LaunchAgent** runs inside your login session, which is why it inherits your
permissions rather than needing its own grant.

```bash
python3 scripts/gen_launchagents.py --out ~/Library/LaunchAgents
for f in ~/Library/LaunchAgents/com.matthlh.career-pipeline.*.plist; do
  launchctl unload "$f" 2>/dev/null; launchctl load "$f"
done
crontab -l | grep -v career-pipeline | crontab -   # retire the cron entries
```

Run the generator without `--out` first to print the plists and read them.
It never installs anything itself.

Undo:

```bash
for f in ~/Library/LaunchAgents/com.matthlh.career-pipeline.*.plist; do
  launchctl unload "$f"; rm "$f"
done
```

## Checking it worked

```bash
python3 scripts/run.py check
```

The last line reports the schedule. It looks for a completed job — a
`=== <job> done:` line — rather than for known error strings, because the
version that grepped for `Traceback` reported "ok" against a log in which every
single line was a permission error.
