// Turns the audit CSVs into your attention numbers and a shareable card,
// using only what ships with macOS (JavaScript for Automation + AppKit).
// Usage: osascript -l JavaScript card.js <data_dir> <out.png>
// Prints the text report. The card never shows app names.

ObjC.import('AppKit');

const IDLE = 'idle';
const FOCUSED_SECONDS = 600;
const SHORT_SECONDS = 120;

// ---------- stats ----------

function readSamples(dataDir) {
  const fm = $.NSFileManager.defaultManager;
  const names = ObjC.deepUnwrap(fm.contentsOfDirectoryAtPathError(dataDir, null)) || [];
  const samples = [];
  names.filter(n => /^audit_\d{4}-\d{2}-\d{2}\.csv$/.test(n)).forEach(name => {
    const raw = $.NSString.stringWithContentsOfFileEncodingError(dataDir + '/' + name, $.NSUTF8StringEncoding, null);
    ObjC.unwrap(raw).split('\n').slice(1).forEach(line => {
      const comma = line.indexOf(',');
      if (comma < 0) return;
      const iso = line.slice(0, comma);
      const ts = new Date(iso);
      if (isNaN(ts)) return;
      samples.push({ ts, day: iso.slice(0, 10), app: line.slice(comma + 1).replace(/^"|"$/g, '') });
    });
  });
  return samples.sort((a, b) => a.ts - b.ts);
}

function intervalSeconds(samples) {
  const gaps = [];
  for (let i = 1; i < samples.length; i++) {
    const g = (samples[i].ts - samples[i - 1].ts) / 1000;
    if (g < 300) gaps.push(g);
  }
  return gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 30;
}

// A gap means the logger was not sampling (mac asleep, agent stopped), so
// samples either side of one are not a single uninterrupted stretch.
function activeBlocks(samples, step) {
  const maxGap = step * 2.5;
  const blocks = [];
  let current = [];
  let prev = null;
  samples.forEach(s => {
    const gap = prev && (s.ts - prev.ts) / 1000 > maxGap;
    if (s.app === IDLE || gap) {
      if (current.length) blocks.push(current);
      current = [];
    }
    if (s.app !== IDLE) current.push(s);
    prev = s;
  });
  if (current.length) blocks.push(current);
  return blocks;
}

function runsIn(block, step) {
  const out = [];
  let app = block[0].app;
  let count = 1;
  block.slice(1).forEach(s => {
    if (s.app === app) {
      count++;
    } else {
      out.push({ app, seconds: count * step });
      app = s.app;
      count = 1;
    }
  });
  out.push({ app, seconds: count * step });
  return out;
}

function fmt(seconds) {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}m${String(s).padStart(2, '0')}s`;
}

function compute(samples) {
  const step = intervalSeconds(samples);
  const blocks = activeBlocks(samples, step);
  if (!blocks.length) return null;

  const runs = [];
  let switches = 0;
  const byHour = new Array(24).fill(0);
  const perApp = {};
  const pulls = {};
  blocks.forEach(block => {
    const blockRuns = runsIn(block, step);
    blockRuns.forEach((r, i) => {
      runs.push(r);
      perApp[r.app] = (perApp[r.app] || 0) + r.seconds;
      if (i > 0) {
        switches++;
        pulls[r.app] = (pulls[r.app] || 0) + 1;
      }
    });
    for (let i = 1; i < block.length; i++) {
      if (block[i].app !== block[i - 1].app) byHour[block[i].ts.getHours()]++;
    }
  });

  const durations = runs.map(r => r.seconds).sort((a, b) => a - b);
  const active = durations.reduce((a, b) => a + b, 0);
  const days = new Set(samples.map(s => s.day)).size;
  const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
  return {
    days,
    active,
    switches,
    switchesPerDay: switches / days,
    switchesPerHour: active ? switches / (active / 3600) : 0,
    medianRun: durations[Math.floor(durations.length / 2)],
    shortPct: durations.filter(d => d < SHORT_SECONDS).length / runs.length * 100,
    focusedPct: durations.filter(d => d >= FOCUSED_SECONDS).length / runs.length * 100,
    longestRun: durations[durations.length - 1],
    byHour,
    perApp: top(perApp, 10),
    pulls: top(pulls, 8),
  };
}

function textReport(s) {
  const lines = [
    'ATTENTION AUDIT',
    `days logged         ${s.days}`,
    `active time         ${fmt(s.active)}`,
    '',
    `app switches        ${s.switches}`,
    `  per day           ${Math.round(s.switchesPerDay)}`,
    `  per active hour   ${s.switchesPerHour.toFixed(1)}`,
    '',
    `median focus run    ${fmt(s.medianRun)}`,
    `  under 2 min       ${Math.round(s.shortPct)}% of runs`,
    `  over 10 min       ${Math.round(s.focusedPct)}% of runs`,
    `  longest run       ${fmt(s.longestRun)}`,
    '',
    '--- time per app ---',
    ...s.perApp.map(([app, sec]) => `  ${fmt(sec).padStart(7)}  ${(sec / s.active * 100).toFixed(1).padStart(5)}%  ${app}`),
    '',
    '--- what pulls you away ---',
    ...s.pulls.map(([app, n]) => `  ${String(n).padStart(4)}x  ${app}`),
  ];
  if (s.active < 3600) lines.splice(1, 0, `!! only ${fmt(s.active)} of activity so far. let it run longer.`);
  return lines.join('\n');
}

// ---------- card ----------
// AppKit's origin is bottom-left, so every y below goes through top().

const W = 1200;
const H = 675;
const PAD = 72;

const INK = [0.945, 0.941, 0.929];
const MUTED = [0.537, 0.549, 0.573];
const ACCENT = [0.2, 0.706, 0.867];
const NUDGE = [1, 0.22, 0.18];
const BG = [0.082, 0.09, 0.102];
const TRACK = [0.2, 0.212, 0.235];

function color(rgb) {
  return $.NSColor.colorWithSRGBRedGreenBlueAlpha(rgb[0], rgb[1], rgb[2], 1);
}

function top(y, height) {
  return H - y - height;
}

function attrsFor(size, weight, rgb) {
  const attrs = $.NSMutableDictionary.alloc.init;
  attrs.setObjectForKey($.NSFont.systemFontOfSizeWeight(size, weight), $.NSFontAttributeName);
  attrs.setObjectForKey(color(rgb), $.NSForegroundColorAttributeName);
  return attrs;
}

function text(str, x, y, size, rgb, weight) {
  const attrs = attrsFor(size, weight, rgb);
  const s = $(str);
  const sz = s.sizeWithAttributes(attrs);
  s.drawAtPointWithAttributes($.NSMakePoint(x, top(y, sz.height)), attrs);
  return sz.width;
}

function rect(x, y, w, h, rgb, radius) {
  color(rgb).setFill;
  $.NSBezierPath.bezierPathWithRoundedRectXRadiusYRadius(
    $.NSMakeRect(x, top(y, h), w, h), radius, radius).fill;
}

function stat(x, y, value, label, rgb) {
  text(value, x, y, 46, rgb, $.NSFontWeightSemibold);
  text(label, x, y + 60, 20, MUTED, $.NSFontWeightRegular);
}

function hourChart(byHour, x, y, w, h) {
  const peak = Math.max(1, ...byHour);
  const gap = 6;
  const barW = (w - gap * 23) / 24;
  byHour.forEach((count, hour) => {
    const bx = x + hour * (barW + gap);
    rect(bx, y, barW, h, TRACK, 3);
    const bh = Math.max(count ? 4 : 0, (count / peak) * h);
    if (bh) rect(bx, y + h - bh, barW, bh, count === peak ? NUDGE : ACCENT, 3);
  });
  [0, 6, 12, 18, 23].forEach(hour => {
    text(String(hour).padStart(2, '0') + 'h', x + hour * (barW + gap) - 2, y + h + 10, 15, MUTED, $.NSFontWeightRegular);
  });
}

function drawCard(s, outPath) {
  const rep = $.NSBitmapImageRep.alloc
    .initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
      null, W, H, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);
  const ctx = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep);
  $.NSGraphicsContext.setCurrentContext(ctx);

  rect(0, 0, W, H, BG, 0);

  const dayLabel = s.days === 1 ? '1 day' : s.days + ' days';
  text('attention audit · ' + dayLabel + ' on my mac', PAD, PAD - 8, 22, MUTED, $.NSFontWeightMedium);

  const numW = text(String(Math.round(s.switchesPerDay)), PAD, PAD + 28, 132, INK, $.NSFontWeightBold);
  text('app switches', PAD + numW + 24, PAD + 70, 34, INK, $.NSFontWeightMedium);
  text('a day', PAD + numW + 24, PAD + 112, 34, MUTED, $.NSFontWeightMedium);

  const rowY = 300;
  const col = (W - PAD * 2) / 4;
  stat(PAD, rowY, fmt(s.medianRun), 'median focus stretch', INK);
  stat(PAD + col, rowY, Math.round(s.shortPct) + '%', 'of stretches under 2 min', NUDGE);
  stat(PAD + col * 2, rowY, Math.round(s.focusedPct) + '%', 'of stretches over 10 min', ACCENT);
  stat(PAD + col * 3, rowY, s.switchesPerHour.toFixed(1), 'switches per active hour', INK);

  text('switches by hour of day', PAD, 440, 18, MUTED, $.NSFontWeightMedium);
  hourChart(s.byHour, PAD, 474, W - PAD * 2, 110);

  const credit = 'github.com/M4XGO/attention-audit · @NonyMaxime';
  const creditW = $(credit).sizeWithAttributes(attrsFor(15, $.NSFontWeightRegular, MUTED)).width;
  text(credit, W - PAD - creditW, PAD - 4, 15, MUTED, $.NSFontWeightRegular);

  ctx.flushGraphics;
  const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
  if (!png.writeToFileAtomically(outPath, true)) throw new Error('could not write ' + outPath);
}

// ---------- entry ----------

function run(argv) {
  const [dataDir, outPath] = argv;
  const samples = readSamples(dataDir);
  if (samples.length < 2) throw new Error('not enough data yet. let the audit run a few hours.');
  const stats = compute(samples);
  if (!stats) throw new Error('every sample is idle. was the mac asleep the whole time?');
  drawCard(stats, outPath);
  // Last line is machine-read by card.sh to prefill the post.
  return textReport(stats) + '\n' + JSON.stringify({
    days: stats.days,
    perDay: Math.round(stats.switchesPerDay),
    median: fmt(stats.medianRun),
  });
}
