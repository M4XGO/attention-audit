// Draws the shareable attention card with macOS AppKit, no dependencies.
// Called by report.py: osascript -l JavaScript card.js <stats.json> <out.png>
// AppKit's origin is bottom-left, so every y below goes through top().

ObjC.import('AppKit');

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

function font(size, weight) {
  return $.NSFont.systemFontOfSizeWeight(size, weight);
}

function text(str, x, y, size, rgb, weight) {
  const attrs = $.NSMutableDictionary.alloc.init;
  attrs.setObjectForKey(font(size, weight), $.NSFontAttributeName);
  attrs.setObjectForKey(color(rgb), $.NSForegroundColorAttributeName);
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

function run(argv) {
  const raw = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null);
  const s = JSON.parse(ObjC.unwrap(raw));

  const rep = $.NSBitmapImageRep.alloc
    .initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
      null, W, H, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);
  const ctx = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep);
  $.NSGraphicsContext.setCurrentContext(ctx);

  rect(0, 0, W, H, BG, 0);

  text('attention audit · ' + s.days + ' days on my mac', PAD, PAD - 8, 22, MUTED, $.NSFontWeightMedium);

  const numW = text(String(s.switches_per_day), PAD, PAD + 28, 132, INK, $.NSFontWeightBold);
  text('app switches', PAD + numW + 24, PAD + 70, 34, INK, $.NSFontWeightMedium);
  text('a day', PAD + numW + 24, PAD + 112, 34, MUTED, $.NSFontWeightMedium);

  const rowY = 300;
  const col = (W - PAD * 2) / 4;
  stat(PAD, rowY, s.median_run, 'median focus stretch', INK);
  stat(PAD + col, rowY, s.short_pct + '%', 'of stretches under 2 min', NUDGE);
  stat(PAD + col * 2, rowY, s.focused_pct + '%', 'of stretches over 10 min', ACCENT);
  stat(PAD + col * 3, rowY, String(s.switches_per_hour), 'switches per active hour', INK);

  text('switches by hour of day', PAD, 440, 18, MUTED, $.NSFontWeightMedium);
  hourChart(s.by_hour, PAD, 474, W - PAD * 2, 110);

  const credit = 'github.com/M4XGO/attention-audit';
  const attrs = $.NSMutableDictionary.alloc.init;
  attrs.setObjectForKey(font(15, $.NSFontWeightRegular), $.NSFontAttributeName);
  const creditW = $(credit).sizeWithAttributes(attrs).width;
  text(credit, W - PAD - creditW, PAD - 4, 15, MUTED, $.NSFontWeightRegular);

  ctx.flushGraphics;
  const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
  if (!png.writeToFileAtomically(argv[1], true)) throw new Error('could not write ' + argv[1]);
  return 'ok';
}
