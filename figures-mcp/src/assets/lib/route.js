// GENERATED from src/route.ts by scripts/build-lib.ts — do not edit.
// src/route.ts
var LANE_STEP_FACTOR = 3;
var DETOUR_LENGTH_LIMIT = 4;
var SIDES = ["top", "right", "bottom", "left"];
var clamp01 = (n) => n < 0 ? 0 : n > 1 ? 1 : n;
function parsePort(port) {
  const [rawSide, rawFraction] = port.split(":");
  const side = rawSide.trim();
  if (!SIDES.includes(side))
    throw new Error(`unknown port side "${rawSide}" (use top|right|bottom|left[:0..1])`);
  if (rawFraction === undefined)
    return { side, fraction: 0.5 };
  const f = Number(rawFraction);
  if (!Number.isFinite(f))
    throw new Error(`unknown port fraction "${rawFraction}"`);
  return { side, fraction: clamp01(f) };
}
function anchorAt(r, side, fraction) {
  const f = clamp01(fraction);
  if (side === "top")
    return [r.x + r.w * f, r.y];
  if (side === "bottom")
    return [r.x + r.w * f, r.y + r.h];
  if (side === "left")
    return [r.x, r.y + r.h * f];
  return [r.x + r.w, r.y + r.h * f];
}
function autoSides(a, b) {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  if (Math.abs(dx) > Math.abs(dy))
    return dx > 0 ? ["right", "left"] : ["left", "right"];
  return dy > 0 ? ["bottom", "top"] : ["top", "bottom"];
}
function segmentHitsRect(p, q, r, clearance = 0) {
  const minX = r.x - clearance;
  const minY = r.y - clearance;
  const maxX = r.x + r.w + clearance;
  const maxY = r.y + r.h + clearance;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const num = [p[0] - minX, maxX - p[0], p[1] - minY, maxY - p[1]];
  const den = [-dx, dx, -dy, dy];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0;i < 4; i++) {
    if (den[i] === 0) {
      if (num[i] < 0)
        return false;
      continue;
    }
    const t = num[i] / den[i];
    if (den[i] < 0) {
      if (t > t1)
        return false;
      if (t > t0)
        t0 = t;
    } else {
      if (t < t0)
        return false;
      if (t < t1)
        t1 = t;
    }
  }
  return t0 <= t1;
}
function polylineHits(points, obstacles, clearance = 0) {
  let hits = 0;
  for (const rect of obstacles) {
    for (let i = 0;i + 1 < points.length; i++) {
      if (segmentHitsRect(points[i], points[i + 1], rect, clearance)) {
        hits++;
        break;
      }
    }
  }
  return hits;
}
var length = (points) => {
  let total = 0;
  for (let i = 0;i + 1 < points.length; i++)
    total += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  return total;
};
var horizontal = (side) => side === "left" || side === "right";
var TEXT_BLOCKER = "a text label";
function routePath(input) {
  const { from, to, obstacles, textRects, clearance, lanes } = input;
  const [autoA, autoB] = autoSides(from, to);
  const pa = parsePort(input.portFrom ?? autoA);
  const pb = parsePort(input.portTo ?? autoB);
  const a = anchorAt(from, pa.side, pa.fraction);
  const b = anchorAt(to, pb.side, pb.fraction);
  const degenerate = Math.hypot(b[0] - a[0], b[1] - a[1]) < 21;
  const midX = (a[0] + b[0]) / 2;
  const midY = (a[1] + b[1]) / 2;
  const hvh = (x) => [a, [x, a[1]], [x, b[1]], b];
  const vhv = (y) => [a, [a[0], y], [b[0], y], b];
  const acrossFlow = (v) => horizontal(pa.side) ? vhv(midY + v) : hvh(midX + v);
  const candidates = [];
  if (input.mode !== "ortho")
    candidates.push({ points: [a, b], kind: "straight", shift: input.mode === "straight" ? null : acrossFlow });
  if (input.mode !== "straight") {
    const z = { points: hvh(midX), kind: "ortho", shift: (d) => hvh(midX + d) };
    const zAlt = { points: vhv(midY), kind: "ortho", shift: (d) => vhv(midY + d) };
    if (horizontal(pa.side))
      candidates.push(z, zAlt);
    else
      candidates.push(zAlt, z);
  }
  const obstacleRects = obstacles.map((o) => o.rect);
  const score = (points2) => polylineHits(points2, obstacleRects, clearance) + polylineHits(points2, textRects, clearance);
  const gap = clearance + 6;
  const limit = Math.hypot(b[0] - a[0], b[1] - a[1]) * DETOUR_LENGTH_LIMIT;
  if (input.mode !== "straight") {
    const blockers = [...obstacleRects, ...textRects].filter((r) => candidates.some((c) => polylineHits(c.points, [r], clearance) > 0));
    const detour = (at, make) => {
      const points2 = make(at);
      if (length(points2) > limit)
        return;
      candidates.push({ points: points2, kind: "detour", shift: (d) => make(at + d) });
    };
    for (const r of blockers) {
      if (horizontal(pa.side)) {
        detour(r.y - gap, vhv);
        detour(r.y + r.h + gap, vhv);
      } else {
        detour(r.x - gap, hvh);
        detour(r.x + r.w + gap, hvh);
      }
    }
  }
  let best = candidates[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const s = score(c.points);
    if (s < bestScore || s === bestScore && length(c.points) < length(best.points) - 0.5) {
      best = c;
      bestScore = s;
    }
    if (s === 0 && c.kind === "straight")
      break;
  }
  let points = best.points;
  let kind = best.kind;
  const shift = best.shift;
  if (bestScore > 0) {
    kind = "blocked";
  } else if (lanes.length && shift) {
    let occupied = 0;
    for (const l of lanes)
      if (polylineHits(points, corridorRects(l), 0) > 0)
        occupied++;
    const step = (input.strokeWidth ?? 1) * LANE_STEP_FACTOR;
    for (let lane = occupied;lane >= 1; lane--) {
      const shifted = shift(lane * step * (lane % 2 === 0 ? -1 : 1));
      if (score(shifted) > 0)
        continue;
      points = shifted;
      if (kind === "straight" && shifted.length > 2)
        kind = "ortho";
      break;
    }
  }
  const blocked = [];
  if (bestScore > 0) {
    for (const o of obstacles)
      if (polylineHits(points, [o.rect], clearance) > 0)
        blocked.push(o.selector);
    if (polylineHits(points, textRects, clearance) > 0)
      blocked.push(TEXT_BLOCKER);
  }
  return { points, kind, blocked, degenerate };
}
function corridorRects(c) {
  const half = Math.max(c.width, 1) / 2 + 1;
  const out = [];
  for (let i = 0;i + 1 < c.points.length; i++) {
    const [x1, y1] = c.points[i];
    const [x2, y2] = c.points[i + 1];
    out.push({
      x: Math.min(x1, x2) - half,
      y: Math.min(y1, y2) - half,
      w: Math.abs(x2 - x1) + half * 2,
      h: Math.abs(y2 - y1) + half * 2
    });
  }
  return out;
}
function pickPlacement(size, near, avoid, gap) {
  const cx = near.x + near.w / 2 - size.w / 2;
  const cy = near.y + near.h / 2 - size.h / 2;
  const candidates = [
    { x: near.x + near.w + gap, y: cy },
    { x: cx, y: near.y + near.h + gap },
    { x: near.x - gap - size.w, y: cy },
    { x: cx, y: near.y - gap - size.h },
    { x: near.x + near.w + gap, y: near.y - gap - size.h },
    { x: near.x + near.w + gap, y: near.y + near.h + gap },
    { x: near.x - gap - size.w, y: near.y - gap - size.h },
    { x: near.x - gap - size.w, y: near.y + near.h + gap }
  ];
  const hits = (c, r) => c.x < r.x + r.w && r.x < c.x + size.w && c.y < r.y + r.h && r.y < c.y + size.h;
  for (const c of candidates)
    if (!hits(c, near) && !avoid.some((r) => hits(c, r)))
      return c;
  return null;
}
function pathData(points) {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");
}
export {
  segmentHitsRect,
  routePath,
  polylineHits,
  pickPlacement,
  pathData,
  parsePort,
  autoSides,
  anchorAt,
  TEXT_BLOCKER,
  LANE_STEP_FACTOR,
  DETOUR_LENGTH_LIMIT
};
