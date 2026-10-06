import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COLORS, PAGE_MARGIN, drawFooter, formatDateTime } from "./reportPdf.js";
import { categoryToneHex } from "./categoryToneHex.js";
import { UPLOAD_DIR } from "../middleware/upload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PSU_SEAL = path.join(__dirname, "..", "assets", "psu-seal.png");
const SAA_SEAL = path.join(__dirname, "..", "assets", "saa-seal.png");

// Same color used for these lines on the live chart (frontend/src/
// components/ui/HierarchyChart.jsx) — keep the two in sync so a
// "connected to" link reads the same way on screen and on paper.
const CONNECTION_LINE_COLOR = "#9333ea";

// Same parent/child grouping the on-screen HierarchyChart.jsx uses — kept
// in lockstep so the PDF export always matches what's on screen, down to
// sibling order (an officer with no valid parent becomes a root, and an
// org can have more than one root, e.g. a President and an Adviser side
// by side).
// An officer can have up to TWO positions above them: the box hangs under
// the first, and a second solid line is drawn up to the other. (Mirrors
// resolveParents() in the frontends' components/ui/hierarchyLinks.js.)
function resolveParents(officer, byId) {
  const first = officer.parent_officer_id && byId.has(officer.parent_officer_id) ? officer.parent_officer_id : null;
  const second =
    officer.second_parent_officer_id && byId.has(officer.second_parent_officer_id) && officer.second_parent_officer_id !== first
      ? officer.second_parent_officer_id
      : null;
  if (!first && second) return { primary: second, secondary: null };
  return { primary: first, secondary: second };
}

function buildForest(officers) {
  const byId = new Map(officers.map((o) => [o.id, { ...o, children: [] }]));
  const roots = [];
  for (const o of byId.values()) {
    const { primary } = resolveParents(o, byId);
    if (primary) byId.get(primary).children.push(o);
    else roots.push(o);
  }
  return roots;
}

// [parentId, childId] for each officer's second position above.
function secondParentLinks(officers) {
  const byId = new Map(officers.map((o) => [o.id, o]));
  const links = [];
  for (const o of officers) {
    const { secondary } = resolveParents(o, byId);
    if (secondary) links.push([secondary, o.id]);
  }
  return links;
}

// Leaf-count "width" of each subtree (a leaf is 1 unit wide; a parent is
// as wide as the sum of its children) — the standard trick for laying out
// a tree diagram left-to-right without any node overlapping another.
function computeWidth(node) {
  if (!node.children.length) {
    node._width = 1;
    return 1;
  }
  node._width = node.children.reduce((sum, c) => sum + computeWidth(c), 0);
  return node._width;
}

function computeDepth(node, depth, state) {
  node._depth = depth;
  state.maxDepth = Math.max(state.maxDepth, depth);
  node.children.forEach((c) => computeDepth(c, depth + 1, state));
}

// Assigns each node a horizontal "slot" center (in width-units, not
// pixels yet) by placing leaves left-to-right and centering every parent
// over its own children's span.
function assignSlots(node, leftSlot) {
  if (!node.children.length) {
    node._slot = leftSlot + 0.5;
    return leftSlot + 1;
  }
  let cursor = leftSlot;
  node.children.forEach((c) => {
    cursor = assignSlots(c, cursor);
  });
  const first = node.children[0];
  const last = node.children[node.children.length - 1];
  node._slot = (first._slot + last._slot) / 2;
  return cursor;
}

function flatten(node, out) {
  out.push(node);
  node.children.forEach((c) => flatten(c, out));
  return out;
}

// Same dedup as the live chart's uniqueConnectionPairs — every undirected
// "connected to" pair appears once even though both sides list each other.
function uniqueConnectionPairs(officers) {
  const byId = new Map(officers.map((o) => [o.id, o]));
  const seen = new Set();
  const pairs = [];
  for (const o of officers) {
    for (const targetId of o.connected_officer_ids || []) {
      if (!byId.has(targetId)) continue;
      const key = [o.id, targetId].sort((a, b) => a - b).join("-");
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([o.id, targetId]);
    }
  }
  return pairs;
}

// Draws an officer's photo clipped to a circle, cropped to cover (not
// stretch) the circle the same way the on-screen avatar does. Falls back
// to an initial-letter medallion, tinted with the officer's own category
// color, when there's no photo, the file is missing on disk, or it's a
// format pdfkit can't embed (it only reads JPEG/PNG).
function drawOfficerPhoto(doc, node, cx, cy, radius, tone) {
  const filePath = node.photo?.stored_name ? path.join(UPLOAD_DIR, node.photo.stored_name) : null;
  if (filePath && fs.existsSync(filePath)) {
    try {
      doc.save();
      doc.circle(cx, cy, radius).clip();
      doc.image(filePath, cx - radius, cy - radius, { cover: [radius * 2, radius * 2], align: "center", valign: "center" });
      doc.restore();
      return;
    } catch {
      doc.restore(); // clip/image failed partway through — don't leave an active clip region behind
    }
  }
  const initial = (node.name || "?").trim().charAt(0).toUpperCase() || "?";
  doc.circle(cx, cy, radius).fill(tone.bg);
  doc.circle(cx, cy, radius).lineWidth(0.75).strokeColor(tone.text).stroke();
  const fontSize = Math.max(7, radius * 1.05);
  doc.fillColor(tone.text).font("Helvetica-Bold").fontSize(fontSize);
  const tw = doc.widthOfString(initial);
  doc.text(initial, cx - tw / 2, cy - fontSize * 0.38, { lineBreak: false });
}

function drawCompactHeader(doc, { orgName, collegeName, generatedAt, generatedBy, officerCount }) {
  const pageWidth = doc.page.width;
  const bannerHeight = 54;
  const sealSize = 36;

  const gradient = doc.linearGradient(0, 0, pageWidth, 0);
  gradient.stop(0, COLORS.navyBannerFrom).stop(1, COLORS.navyBannerTo);
  doc.rect(0, 0, pageWidth, bannerHeight).fill(gradient);
  doc.rect(0, bannerHeight, pageWidth, 3).fill(COLORS.gold);

  const sealY = (bannerHeight - sealSize) / 2;
  if (fs.existsSync(PSU_SEAL)) doc.image(PSU_SEAL, PAGE_MARGIN, sealY, { width: sealSize, height: sealSize });
  if (fs.existsSync(SAA_SEAL)) doc.image(SAA_SEAL, pageWidth - PAGE_MARGIN - sealSize, sealY, { width: sealSize, height: sealSize });

  const textInset = PAGE_MARGIN + sealSize + 20;
  const textWidth = pageWidth - textInset * 2;
  doc
    .fillColor(COLORS.white)
    .font("Helvetica-Bold")
    .fontSize(15)
    .text(`${orgName} \u2014 Organizational Chart`, textInset, bannerHeight / 2 - 15, { align: "center", width: textWidth, ellipsis: true });
  doc
    .fillColor(COLORS.gold)
    .font("Helvetica")
    .fontSize(8.5)
    .text(collegeName || "Pangasinan State University \u2014 Lingayen Campus", textInset, bannerHeight / 2 + 4, {
      align: "center",
      width: textWidth,
      ellipsis: true,
    });

  let y = bannerHeight + 3 + 12;
  doc
    .fillColor(COLORS.slate500)
    .font("Helvetica")
    .fontSize(8)
    .text(
      `Generated: ${formatDateTime(generatedAt)}  \u00b7  Generated by: ${generatedBy || "OSAA-TRACK Admin"}  \u00b7  ${officerCount} officer${
        officerCount === 1 ? "" : "s"
      }`,
      PAGE_MARGIN,
      y,
      { width: pageWidth - PAGE_MARGIN * 2, align: "center" }
    );
  y += 18;
  return y;
}

function truncate(doc, text, width) {
  let t = text || "";
  while (t.length > 1 && doc.widthOfString(t) > width) t = t.slice(0, -1);
  return t.length < (text || "").length ? `${t.slice(0, -1)}\u2026` : t;
}

/**
 * Renders one organization's officer hierarchy as a connected-box tree
 * diagram (landscape, auto-scaled to fit one page) directly to a writable
 * stream (e.g. an HTTP response) or a file path.
 *
 * @param {object} opts
 * @param {string} opts.orgName
 * @param {string|null} [opts.collegeName]
 * @param {object[]} opts.officers - rows from studentLeadersRepo (id, name, position, category, parent_officer_id)
 * @param {string|null} [opts.generatedBy]
 * @param {Date} [opts.generatedAt]
 * @param {import('stream').Writable|string} target - a writable stream or a file path
 */
export function buildOrgChartPdf({ orgName, collegeName = null, officers = [], generatedBy = null, generatedAt = new Date() }, target) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      layout: "landscape",
      margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
      bufferPages: true,
      info: { Title: `${orgName} - Organizational Chart`, Author: "OSAA-TRACK Admin Panel" },
    });
    const stream = typeof target === "string" ? fs.createWriteStream(target) : target;
    doc.pipe(stream);

    const contentWidth = doc.page.width - PAGE_MARGIN * 2;
    let y = drawCompactHeader(doc, { orgName, collegeName, generatedAt, generatedBy, officerCount: officers.length });

    if (!officers.length) {
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor(COLORS.slate400)
        .text("No officers have been added to this organization yet.", PAGE_MARGIN, y + 40, { width: contentWidth, align: "center" });
      finish();
      return;
    }

    const roots = buildForest(officers);
    const totalWidth = roots.reduce((sum, r) => sum + computeWidth(r), 0);
    const depthState = { maxDepth: 0 };
    roots.forEach((r) => computeDepth(r, 0, depthState));
    let cursor = 0;
    roots.forEach((r) => {
      cursor = assignSlots(r, cursor);
    });

    const allNodes = roots.flatMap((r) => flatten(r, []));
    const connectionPairs = uniqueConnectionPairs(officers);
    const parentLinks = secondParentLinks(officers);
    const nodesById = new Map(allNodes.map((n) => [n.id, n]));

    // Auto-scale box size so the whole tree fits the page in both
    // directions — this is what keeps the export to one page regardless
    // of how many officers or levels an organization has. The legend (if
    // there are any "connected to" links to explain) takes a fixed strip
    // at the bottom, so it comes out of the available height up front
    // rather than the tree's own layout math.
    const legendHeight = connectionPairs.length > 0 ? 20 : 0;
    const availableHeight = doc.page.height - PAGE_MARGIN - y - 20 - legendHeight;
    const levels = depthState.maxDepth + 1;
    const unitWidth = contentWidth / Math.max(totalWidth, 1);
    const boxWidth = Math.max(58, Math.min(140, unitWidth - 14));
    const levelHeight = Math.max(66, Math.min(112, availableHeight / levels));
    const boxHeight = Math.max(48, Math.min(84, levelHeight - 30));
    // Photos are dropped on very dense/deep charts where there just isn't
    // room to keep them legible — same graceful-degradation idea as the
    // existing category-badge cutoff below.
    const showPhotos = boxHeight >= 56;
    const photoRadius = showPhotos ? Math.min(15, boxHeight * 0.22) : 0;

    function centerX(node) {
      return PAGE_MARGIN + node._slot * unitWidth;
    }
    function topY(node) {
      return y + node._depth * levelHeight;
    }
    function midY(node) {
      return topY(node) + boxHeight / 2;
    }

    // ── connector lines first (drawn underneath the boxes) ─────────
    doc.lineWidth(1).strokeColor(COLORS.slate400);
    allNodes.forEach((node) => {
      if (!node.children.length) return;
      const parentX = centerX(node);
      const parentBottom = topY(node) + boxHeight;
      const dropY = parentBottom + (levelHeight - boxHeight) / 2;
      doc.moveTo(parentX, parentBottom).lineTo(parentX, dropY).stroke();
      const childXs = node.children.map((c) => centerX(c));
      const minX = Math.min(...childXs);
      const maxX = Math.max(...childXs);
      if (node.children.length > 1) {
        doc.moveTo(minX, dropY).lineTo(maxX, dropY).stroke();
      }
      node.children.forEach((c) => {
        doc.moveTo(centerX(c), dropY).lineTo(centerX(c), topY(c)).stroke();
      });
    });

    // Second position above: the same solid line as the hierarchy, drawn as a
    // smooth curve straight from that position to the box (a right-angle
    // route would have to share the tree's connector bars and make it look as
    // though the position were connected to every sibling too).
    doc.lineWidth(1).strokeColor(COLORS.slate400);
    parentLinks.forEach(([parentId, childId]) => {
      const p = nodesById.get(parentId);
      const c = nodesById.get(childId);
      if (!p || !c) return;
      const x1 = centerX(p);
      const x2 = centerX(c);
      const pTop = topY(p);
      const pBottom = pTop + boxHeight;
      const cTop = topY(c);
      const cBottom = cTop + boxHeight;
      if (cTop >= pBottom + 6) {
        const dy = Math.max(18, (cTop - pBottom) * 0.5);
        doc.moveTo(x1, pBottom).bezierCurveTo(x1, pBottom + dy, x2, cTop - dy, x2, cTop).stroke();
      } else if (pTop >= cBottom + 6) {
        const dy = Math.max(18, (pTop - cBottom) * 0.5);
        doc.moveTo(x1, pTop).bezierCurveTo(x1, pTop - dy, x2, cBottom + dy, x2, cBottom).stroke();
      } else {
        // same row — join the facing sides
        const right = x2 >= x1;
        const xa = right ? x1 + boxWidth / 2 : x1 - boxWidth / 2;
        const xb = right ? x2 - boxWidth / 2 : x2 + boxWidth / 2;
        const ya = pTop + boxHeight / 2;
        const yb = cTop + boxHeight / 2;
        const d = Math.max(18, Math.abs(xb - xa) * 0.4) * (right ? 1 : -1);
        doc.moveTo(xa, ya).bezierCurveTo(xa + d, ya, xb - d, yb, xb, yb).stroke();
      }
    });

    // "Connected to" links — a second, separate kind of line from the
    // hierarchy above: dashed, and drawn straight between box centers
    // since these can cross between any two branches, not just a parent
    // and its own child.
    if (connectionPairs.length > 0) {
      doc.lineWidth(1.25).strokeColor(CONNECTION_LINE_COLOR).dash(5, { space: 4 });
      connectionPairs.forEach(([aId, bId]) => {
        const a = nodesById.get(aId);
        const b = nodesById.get(bId);
        if (!a || !b) return;
        doc.moveTo(centerX(a), midY(a)).lineTo(centerX(b), midY(b)).stroke();
      });
      doc.undash();
    }

    // ── officer boxes ────────────────────────────────────────────
    const nameSize = boxHeight >= 68 ? 8.5 : boxHeight >= 56 ? 8 : 7.5;
    const posSize = boxHeight >= 68 ? 7.5 : boxHeight >= 56 ? 7 : 6.8;
    allNodes.forEach((node) => {
      const x = centerX(node) - boxWidth / 2;
      const by = topY(node);
      const tone = categoryToneHex(node.category);

      doc.roundedRect(x, by, boxWidth, boxHeight, 6).fill(COLORS.white);
      doc.roundedRect(x, by, boxWidth, boxHeight, 6).lineWidth(1).strokeColor(COLORS.slate200).stroke();
      doc.roundedRect(x, by, boxWidth, 4, 2).fill(tone.text);

      let ty = by + 8;
      if (showPhotos) {
        const cx = x + boxWidth / 2;
        const cy = by + 8 + photoRadius;
        drawOfficerPhoto(doc, node, cx, cy, photoRadius, tone);
        ty = cy + photoRadius + 4;
      } else {
        ty += 4;
      }

      doc
        .fillColor(COLORS.slate900)
        .font("Helvetica-Bold")
        .fontSize(nameSize)
        .text(truncate(doc.font("Helvetica-Bold").fontSize(nameSize), node.name, boxWidth - 12), x + 6, ty, {
          width: boxWidth - 12,
          align: "center",
        });
      ty += nameSize + 3;
      doc
        .fillColor(COLORS.indigoLight)
        .font("Helvetica")
        .fontSize(posSize)
        .text(truncate(doc.font("Helvetica").fontSize(posSize), node.position, boxWidth - 12), x + 6, ty, {
          width: boxWidth - 12,
          align: "center",
        });
      ty += posSize + 4;

      // Only draws if there's genuinely still room left in the box, so
      // this degrades gracefully at any box size rather than relying on
      // a fixed height cutoff that could overflow at an in-between size.
      if (node.category && ty + 11 <= by + boxHeight - 3) {
        const label = truncate(doc.font("Helvetica-Bold").fontSize(6.5), node.category.toUpperCase(), boxWidth - 16);
        const labelWidth = doc.widthOfString(label) + 10;
        doc.roundedRect(x + (boxWidth - labelWidth) / 2, ty, labelWidth, 11, 5.5).fill(tone.bg);
        doc.fillColor(tone.text).font("Helvetica-Bold").fontSize(6.5).text(label, x + (boxWidth - labelWidth) / 2, ty + 2.5, {
          width: labelWidth,
          align: "center",
        });
      }
    });

    // ── legend (only when there's a "connected to" line to explain) ──
    if (connectionPairs.length > 0) {
      const legendY = doc.page.height - PAGE_MARGIN - legendHeight + 6;
      const midXPage = doc.page.width / 2;
      doc.lineWidth(1).strokeColor(COLORS.slate400).moveTo(midXPage - 130, legendY + 4).lineTo(midXPage - 106, legendY + 4).stroke();
      doc.fillColor(COLORS.slate500).font("Helvetica").fontSize(7.5).text("Position above", midXPage - 100, legendY, { lineBreak: false });
      doc.lineWidth(1.25).strokeColor(CONNECTION_LINE_COLOR).dash(5, { space: 4 }).moveTo(midXPage + 10, legendY + 4).lineTo(midXPage + 34, legendY + 4).stroke();
      doc.undash();
      doc.fillColor(COLORS.slate500).font("Helvetica").fontSize(7.5).text("Connected to", midXPage + 40, legendY, { lineBreak: false });
    }

    finish();

    function finish() {
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        drawFooter(doc, i, range.count);
      }
      doc.end();
    }

    stream.on("finish", () => resolve());
    stream.on("error", reject);
    doc.on("error", reject);
  });
}
