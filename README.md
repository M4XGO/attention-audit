# attention audit

How many times a day do you actually switch apps on your Mac? Run this for a week and find out.

![example card](docs/example-card.png)

Two small files, no dependencies, nothing to install:

- `audit.sh` asks macOS which app is in front every 30 seconds and appends it to a CSV in `data/`.
- `report.py` turns those CSVs into your numbers, and with `--card`, into the image above.

## Privacy

Read the scripts before you run them, they are short on purpose.

- Only the **name of the frontmost app** is recorded (`firefox`, `Slack`, ...). No window titles, no URLs, no keystrokes, no screenshots.
- Everything stays in `data/` on your Mac. There is no network call anywhere.
- The card never shows app names, so you can post it as is.
- Delete `data/` and it's gone.

## Run it

```bash
git clone https://github.com/M4XGO/attention-audit.git
cd attention-audit
./audit.sh
```

The first time, macOS asks to give your terminal **Accessibility** access. That's what lets `osascript` read the name of the frontmost app through System Events. You can revoke it any time in System Settings → Privacy & Security → Accessibility.

Leave it running in a terminal tab (or `nohup ./audit.sh &`). After 5 minutes without keyboard or mouse input, samples are logged as `idle` and don't count.

After a few days, ideally 7:

```bash
python3 report.py           # numbers in the terminal
python3 report.py --card    # + card.png, ready to share
```

## What the numbers mean

- **app switches a day**: how often the frontmost app changed while you were active.
- **focus stretch**: an uninterrupted run on a single app. The median tells you how long you typically stay before switching.
- **under 2 min / over 10 min**: share of stretches that were very short vs. long enough to get real work done.
- **switches by hour**: when your day gets most fragmented. The red bars are the peaks.

App-level is a rough proxy: switching from your editor to the docs for the same task counts as a switch. It's a mirror, not a verdict.

## Why this exists

I'm building [Nudge](https://github.com/M4XGO), a Mac app that doesn't block you but brings you back to where you were after a switch. This audit is the throwaway version I used to measure the problem on myself first. It stays free and open source.

## License

MIT
