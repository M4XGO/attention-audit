#!/usr/bin/env python3
"""Turn audit CSVs into your attention numbers, and optionally a shareable card.

"idle" samples (no keyboard or mouse for 5 min) are excluded from active
time, app totals and switch counts, so sleep and lunch don't read as focus.

Usage:
  python3 report.py                 every data/audit_*.csv
  python3 report.py 2026-10-01      one day
  python3 report.py path.csv ...    explicit files
  python3 report.py --card          also render card.png (no app names on it)
                                    and open a prefilled post to share it
  python3 report.py --card --no-share
"""

import csv
import glob
import json
import os
import subprocess
import sys
import tempfile
import urllib.parse
from collections import Counter
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_URL = "github.com/M4XGO/attention-audit"
X_HANDLE = "@NonyMaxime"
IDLE = "idle"
FOCUSED_SECONDS = 600
SHORT_SECONDS = 120


def load(paths):
    samples = []
    for path in paths:
        with open(path, newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                samples.append((datetime.fromisoformat(row["timestamp"]), row["app"]))
    return sorted(samples)


def interval_seconds(samples):
    gaps = [(b[0] - a[0]).total_seconds() for a, b in zip(samples, samples[1:])]
    gaps = [g for g in gaps if g < 300]
    return sum(gaps) / len(gaps) if gaps else 30.0


def active_blocks(samples, step):
    """Split the timeline on idle and on gaps. Each block is real activity.

    A gap means the logger was not sampling: the mac slept, or the process
    was not running. Two samples either side of one are not a single
    uninterrupted stretch, so the block has to break there.
    """
    max_gap = step * 2.5
    blocks, current = [], []
    previous_ts = None
    for ts, app in samples:
        gap = previous_ts and (ts - previous_ts).total_seconds() > max_gap
        if app == IDLE or gap:
            if current:
                blocks.append(current)
                current = []
        if app != IDLE:
            current.append((ts, app))
        previous_ts = ts
    if current:
        blocks.append(current)
    return blocks


def runs_in(block, step):
    """Uninterrupted stretches on one app, in seconds."""
    out = []
    app, count = block[0][1], 1
    for _, nxt in block[1:]:
        if nxt == app:
            count += 1
        else:
            out.append((app, count * step))
            app, count = nxt, 1
    out.append((app, count * step))
    return out


def fmt(seconds):
    minutes, secs = divmod(int(seconds), 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours}h{minutes:02d}" if hours else f"{minutes}m{secs:02d}s"


def compute(samples):
    step = interval_seconds(samples)
    blocks = active_blocks(samples, step)
    if not blocks:
        sys.exit("every sample is idle. was the mac asleep the whole time?")

    runs = [r for block in blocks for r in runs_in(block, step)]
    switches = [r for block in blocks for r in runs_in(block, step)[1:]]
    durations = sorted(duration for _, duration in runs)
    active = sum(durations)
    idle = sum(1 for _, app in samples if app == IDLE) * step
    span = (samples[-1][0] - samples[0][0]).total_seconds()

    by_hour = Counter()
    for block in blocks:
        prev = block[0][1]
        for ts, app in block[1:]:
            if app != prev:
                by_hour[ts.hour] += 1
            prev = app

    per_app = Counter()
    for app, duration in runs:
        per_app[app] += duration

    days = len({ts.date() for ts, _ in samples})
    return {
        "days": days,
        "step": step,
        "active": active,
        "idle": idle,
        "offline": span - active - idle,
        "switches": len(switches),
        "switches_per_day": len(switches) / days,
        "switches_per_hour": len(switches) / (active / 3600) if active else 0,
        "runs": len(runs),
        "median_run": durations[len(durations) // 2],
        "short_pct": sum(1 for d in durations if d < SHORT_SECONDS) / len(runs) * 100,
        "focused": sum(1 for d in durations if d >= FOCUSED_SECONDS),
        "focused_pct": sum(1 for d in durations if d >= FOCUSED_SECONDS) / len(runs) * 100,
        "longest_run": durations[-1],
        "by_hour": {h: by_hour.get(h, 0) for h in range(24)},
        "per_app": per_app.most_common(10),
        "pulls": Counter(app for app, _ in switches).most_common(8),
    }


def print_report(s):
    print("=" * 58)
    print("ATTENTION AUDIT")
    print("=" * 58)
    print(f"days logged         {s['days']}")
    print(f"active time         {fmt(s['active'])}")
    print(f"idle time excluded  {fmt(s['idle'])}")
    print(f"not logged          {fmt(s['offline'])}   (mac asleep or logger off)")
    print(f"sample interval     {s['step']:.0f}s")
    print()

    if s["active"] < 3600:
        print(f"!! only {fmt(s['active'])} of activity so far. let it run longer.")
        print()

    print(f"app switches        {s['switches']}")
    print(f"  per day           {s['switches_per_day']:.0f}")
    print(f"  per active hour   {s['switches_per_hour']:.1f}")
    print()
    print(f"uninterrupted runs  {s['runs']}")
    print(f"  median run        {fmt(s['median_run'])}")
    print(f"  under 2 min       {s['short_pct']:.0f}% of runs")
    print(f"  over 10 min       {s['focused']}  ({s['focused_pct']:.0f}% of runs)")
    print(f"  longest run       {fmt(s['longest_run'])}")
    print()

    print("--- TIME PER APP (top 10) ---")
    for app, duration in s["per_app"]:
        print(f"  {fmt(duration):>7}  {duration / s['active'] * 100:5.1f}%  {app}")
    print()

    print("--- WHAT PULLS YOU AWAY (top 8 destinations) ---")
    for app, count in s["pulls"]:
        print(f"  {count:>4}x  {app}")
    print()

    print("--- SWITCHES PER HOUR OF DAY ---")
    peak = max(s["by_hour"].values()) or 1
    for hour, count in s["by_hour"].items():
        if count:
            print(f"  {hour:02d}h {count:>4} {'#' * int(count / peak * 34)}")


def render_card(s, out_path):
    """Hand the numbers to card.js, which draws the PNG with macOS AppKit.

    App names are left out on purpose: the card is meant to be posted.
    """
    payload = {
        "days": s["days"],
        "switches_per_day": round(s["switches_per_day"]),
        "switches_per_hour": round(s["switches_per_hour"], 1),
        "median_run": fmt(s["median_run"]),
        "short_pct": round(s["short_pct"]),
        "focused_pct": round(s["focused_pct"]),
        "longest_run": fmt(s["longest_run"]),
        "by_hour": [s["by_hour"][h] for h in range(24)],
    }
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(payload, fh)
        json_path = fh.name
    try:
        subprocess.run(
            ["osascript", "-l", "JavaScript", os.path.join(HERE, "card.js"), json_path, out_path],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as err:
        sys.exit(f"card rendering failed: {err.stderr.strip()}")
    finally:
        os.unlink(json_path)
    print()
    print(f"card saved to {out_path}")


def share(s, card_path):
    """Open a prefilled post and reveal the card so attaching it is one drag."""
    text = (
        f"my attention audit, {s['days']} days on my mac:\n\n"
        f"{round(s['switches_per_day'])} app switches a day. "
        f"median focus stretch: {fmt(s['median_run'])}.\n\n"
        f"check yours: {REPO_URL} via {X_HANDLE}"
    )
    url = "https://x.com/intent/post?text=" + urllib.parse.quote(text)
    print()
    print("share it (attach card.png, it just opened in Finder):")
    print(url)
    subprocess.run(["open", "-R", card_path], check=False)
    subprocess.run(["open", url], check=False)


def main():
    args = sys.argv[1:]
    want_card = "--card" in args
    args = [a for a in args if not a.startswith("--")]

    if args:
        paths = [a if a.endswith(".csv") else os.path.join(HERE, "data", f"audit_{a}.csv") for a in args]
    else:
        paths = sorted(glob.glob(os.path.join(HERE, "data", "audit_*.csv")))

    paths = [p for p in paths if os.path.exists(p)]
    if not paths:
        sys.exit("no data/audit_*.csv yet. run: ./audit.sh")

    samples = load(paths)
    if len(samples) < 2:
        sys.exit("not enough samples yet. let it run a few hours.")

    stats = compute(samples)
    print_report(stats)
    if want_card:
        card_path = os.path.join(HERE, "card.png")
        render_card(stats, card_path)
        if "--no-share" not in sys.argv:
            share(stats, card_path)


if __name__ == "__main__":
    main()
