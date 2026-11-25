import {
  ComparableAuditRun,
  MetricComparisonRow,
} from '../components/audit-run-comparison/audit-run-comparison.component';

export interface ComparisonPdfPayload {
  filename: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/**
 * Generates a dependency-free, standards-compliant single-page PDF 1.4 document
 * visualizing the side-by-side radar chart delta between two selected audit runs,
 * complete with a vector hexagonal radar overlay (Baseline, Run A, Run B), KPI delta
 * cards, and the 8-dimension metric breakdown table.
 */
export function buildRadarComparisonDeltaPdf(
  runA: ComparableAuditRun,
  runB: ComparableAuditRun,
  rows: MetricComparisonRow[]
): ComparisonPdfPayload {
  const safeRepoSlug = (runB.repoFullName || runA.repoFullName || 'repository')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const filename = `fresnel-comparison-${safeRepoSlug}-radar-delta.pdf`;

  const sanitizePdfText = (input: string): string =>
    String(input || '')
      .replace(/→/g, '->')
      .replace(/←/g, '<-')
      .replace(/⇄/g, '<->')
      .replace(/⚡/g, '')
      .replace(/·/g, ' | ')
      .replace(/—/g, ' - ')
      .replace(/–/g, '-')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/≤/g, '<=')
      .replace(/≥/g, '>=')
      .replace(/[^\x20-\x7E]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const escapePdf = (input: string): string =>
    sanitizePdfText(input)
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');

  const truncate = (input: string, maxLen: number): string => {
    const clean = sanitizePdfText(input);
    if (clean.length <= maxLen) return clean;
    return `${clean.slice(0, Math.max(4, maxLen - 3)).trim()}...`;
  };

  const ops: string[] = [];

  const setFill = (r: number, g: number, b: number) => {
    ops.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`);
  };
  const setStroke = (r: number, g: number, b: number) => {
    ops.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG`);
  };
  const setLineWidth = (w: number) => {
    ops.push(`${w.toFixed(2)} w`);
  };
  const setDash = (pattern: string) => {
    ops.push(`[${pattern}] 0 d`);
  };
  const rectFill = (x: number, y: number, w: number, h: number, r: number, g: number, b: number) => {
    setFill(r, g, b);
    ops.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  };
  const rectStroke = (
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    g: number,
    b: number,
    lw = 0.8
  ) => {
    setStroke(r, g, b);
    setLineWidth(lw);
    setDash('');
    ops.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
  };
  const drawLine = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    r: number,
    g: number,
    b: number,
    lw = 0.7,
    dash = ''
  ) => {
    setStroke(r, g, b);
    setLineWidth(lw);
    setDash(dash);
    ops.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
    if (dash) setDash('');
  };
  const drawText = (
    text: string,
    x: number,
    y: number,
    size: number,
    font: 'F1' | 'F2' | 'F3' = 'F1',
    r = 0.09,
    g = 0.12,
    b = 0.18
  ) => {
    setFill(r, g, b);
    ops.push(`BT /${font} ${size.toFixed(1)} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapePdf(text)}) Tj ET`);
  };
  const drawCircleFill = (cx: number, cy: number, radius: number, r: number, g: number, b: number) => {
    const k = 0.5522847498 * radius;
    setFill(r, g, b);
    ops.push(
      `${(cx + radius).toFixed(2)} ${cy.toFixed(2)} m ` +
        `${(cx + radius).toFixed(2)} ${(cy + k).toFixed(2)} ${(cx + k).toFixed(2)} ${(cy + radius).toFixed(2)} ${cx.toFixed(2)} ${(cy + radius).toFixed(2)} c ` +
        `${(cx - k).toFixed(2)} ${(cy + radius).toFixed(2)} ${(cx - radius).toFixed(2)} ${(cy + k).toFixed(2)} ${(cx - radius).toFixed(2)} ${cy.toFixed(2)} c ` +
        `${(cx - radius).toFixed(2)} ${(cy - k).toFixed(2)} ${(cx - k).toFixed(2)} ${(cy - radius).toFixed(2)} ${cx.toFixed(2)} ${(cy - radius).toFixed(2)} c ` +
        `${(cx + k).toFixed(2)} ${(cy - radius).toFixed(2)} ${(cx + radius).toFixed(2)} ${(cy - k).toFixed(2)} ${(cx + radius).toFixed(2)} ${cy.toFixed(2)} c f`
    );
  };
  const drawPolygon = (
    pts: { x: number; y: number }[],
    strokeRgb: [number, number, number],
    lw: number,
    dash = '',
    fillRgb?: [number, number, number]
  ) => {
    if (pts.length < 3) return;
    const path =
      pts
        .map((p, i) => `${p.x.toFixed(2)} ${p.y.toFixed(2)} ${i === 0 ? 'm' : 'l'}`)
        .join(' ') + ' h';
    if (fillRgb) {
      setFill(fillRgb[0], fillRgb[1], fillRgb[2]);
      ops.push(`${path} f`);
    }
    setStroke(strokeRgb[0], strokeRgb[1], strokeRgb[2]);
    setLineWidth(lw);
    setDash(dash);
    ops.push(`${path} S`);
    if (dash) setDash('');
  };

  // Page background (US Letter 612 x 792 pt)
  rectFill(0, 0, 612, 792, 1, 1, 1);

  // 1. TOP EXECUTIVE HEADER BANNER
  rectFill(32, 706, 548, 60, 0.06, 0.09, 0.16);
  rectFill(32, 762, 548, 4, 0.05, 0.65, 0.91);
  drawText('FRESNEL  |  SIDE-BY-SIDE AUDIT RADAR COMPARISON & DELTA REPORT', 46, 745, 9.2, 'F3', 0.38, 0.78, 0.98);
  drawText(
    truncate(`Repository: ${runB.repoFullName || runA.repoFullName}`, 56),
    46,
    727,
    13.5,
    'F2',
    1,
    1,
    1
  );
  const generatedStamp = new Date().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  drawText(`Generated ${generatedStamp}  |  Page 1 of 1`, 46, 713, 8.2, 'F3', 0.72, 0.78, 0.86);

  // 2. RUN A vs RUN B SUMMARY CARDS
  const perfDiff = runB.performanceAfter - runA.performanceAfter;
  const a11yDiff = runB.accessibilityAfter - runA.accessibilityAfter;
  const lcpDiff = runB.lcpAfter - runA.lcpAfter;
  const clsDiff = runB.clsAfter - runA.clsAfter;
  const fidDiff = runB.fidAfter - runA.fidAfter;

  // Card A
  rectFill(32, 622, 266, 74, 0.97, 0.98, 0.99);
  rectStroke(32, 622, 266, 74, 0.82, 0.87, 0.92, 0.9);
  rectFill(32, 692, 266, 4, 0.05, 0.65, 0.91);
  drawText('AUDIT RUN A (BASELINE / LEFT RADAR)', 44, 678, 7.6, 'F3', 0.01, 0.52, 0.78);
  drawText(truncate(runA.label, 42), 44, 663, 9.6, 'F2', 0.09, 0.12, 0.18);
  drawText(
    `Perf: ${runA.performanceBefore} -> ${runA.performanceAfter} (+${Math.max(0, runA.performanceAfter - runA.performanceBefore)})  |  A11y: ${runA.accessibilityBefore} -> ${runA.accessibilityAfter} (+${Math.max(0, runA.accessibilityAfter - runA.accessibilityBefore)})`,
    44,
    647,
    8.2,
    'F3',
    0.2,
    0.27,
    0.36
  );
  drawText(
    truncate(`${runA.badge}  |  ${runA.selectedCommitsCount}/${runA.totalCommitsCount} commits  |  ${runA.timestampLabel}`, 48),
    44,
    632,
    7.6,
    'F1',
    0.38,
    0.45,
    0.54
  );

  // Card B
  rectFill(314, 622, 266, 74, 0.95, 0.99, 0.97);
  rectStroke(314, 622, 266, 74, 0.65, 0.87, 0.78, 1.0);
  rectFill(314, 692, 266, 4, 0.06, 0.73, 0.51);
  drawText('AUDIT RUN B (COMPARED / RIGHT RADAR)', 326, 678, 7.6, 'F3', 0.02, 0.59, 0.41);
  drawText(truncate(runB.label, 42), 326, 663, 9.6, 'F2', 0.09, 0.12, 0.18);
  drawText(
    `Perf: ${runB.performanceBefore} -> ${runB.performanceAfter} (+${Math.max(0, runB.performanceAfter - runB.performanceBefore)})  |  A11y: ${runB.accessibilityBefore} -> ${runB.accessibilityAfter} (+${Math.max(0, runB.accessibilityAfter - runB.accessibilityBefore)})`,
    326,
    647,
    8.2,
    'F3',
    0.05,
    0.42,
    0.31
  );
  drawText(
    truncate(`${runB.badge}  |  ${runB.selectedCommitsCount}/${runB.totalCommitsCount} commits  |  ${runB.timestampLabel}`, 48),
    326,
    632,
    7.6,
    'F1',
    0.3,
    0.43,
    0.38
  );

  // 3. VECTOR RADAR CHART DELTA PANEL
  rectFill(32, 344, 548, 268, 0.99, 0.99, 1.0);
  rectStroke(32, 344, 548, 268, 0.85, 0.89, 0.94, 0.9);
  drawText('RADAR CHART DELTA OVERLAY (RUN A vs. RUN B)', 46, 594, 9.5, 'F2', 0.09, 0.12, 0.18);
  drawText(
    '6-axis Lighthouse & Core Web Vitals polygon comparison highlighting net score improvements (0-100 scale)',
    46,
    581,
    8.0,
    'F1',
    0.4,
    0.47,
    0.55
  );

  // 6 Radar Axes
  const radarAxes = [
    { label: 'LCP', base: Math.round((runA.lcpBefore + runB.lcpBefore) / 2), a: runA.lcpAfter, b: runB.lcpAfter },
    { label: 'CLS', base: Math.round((runA.clsBefore + runB.clsBefore) / 2), a: runA.clsAfter, b: runB.clsAfter },
    { label: 'FID', base: Math.round((runA.fidBefore + runB.fidBefore) / 2), a: runA.fidAfter, b: runB.fidAfter },
    { label: 'Perf', base: Math.round((runA.performanceBefore + runB.performanceBefore) / 2), a: runA.performanceAfter, b: runB.performanceAfter },
    { label: 'A11y', base: Math.round((runA.accessibilityBefore + runB.accessibilityBefore) / 2), a: runA.accessibilityAfter, b: runB.accessibilityAfter },
    { label: 'WCAG', base: Math.round((runA.wcagAriaBefore + runB.wcagAriaBefore) / 2), a: runA.wcagAriaAfter, b: runB.wcagAriaAfter },
  ];

  const cx = 192;
  const cy = 462;
  const maxR = 88;
  const count = radarAxes.length;

  const polarPoint = (axisIdx: number, scoreVal: number) => {
    const angle = Math.PI / 2 - (axisIdx * 2 * Math.PI) / count;
    const clamped = Math.max(0, Math.min(100, scoreVal));
    const r = (clamped / 100) * maxR;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  };

  // Concentric hexagonal radar rings (20, 40, 60, 80, 100)
  [20, 40, 60, 80, 100].forEach((level) => {
    const ringPts = radarAxes.map((_, idx) => polarPoint(idx, level));
    drawPolygon(ringPts, [0.85, 0.88, 0.92], level === 100 ? 0.9 : 0.6, level === 100 ? '' : '2 2');
    drawText(String(level), cx + 3, cy + (level / 100) * maxR - 3, 6.8, 'F3', 0.55, 0.61, 0.68);
  });

  // Axis spokes & outer labels with delta
  radarAxes.forEach((axis, idx) => {
    const outer = polarPoint(idx, 100);
    drawLine(cx, cy, outer.x, outer.y, 0.84, 0.88, 0.92, 0.7);

    const angle = Math.PI / 2 - (idx * 2 * Math.PI) / count;
    const labelR = maxR + 18;
    const lx = cx + labelR * Math.cos(angle);
    const ly = cy + labelR * Math.sin(angle);
    const delta = axis.b - axis.a;
    const deltaStr = `${delta >= 0 ? '+' : ''}${delta}`;
    const fullLabel = `${axis.label} (${deltaStr})`;

    let textX = lx - 24;
    if (Math.cos(angle) > 0.3) textX = lx - 6;
    if (Math.cos(angle) < -0.3) textX = lx - 52;
    const textY = ly - 3;

    drawText(
      fullLabel,
      textX,
      textY,
      8.0,
      'F2',
      delta > 0 ? 0.02 : 0.18,
      delta > 0 ? 0.52 : 0.24,
      delta > 0 ? 0.38 : 0.32
    );
  });

  // Draw Baseline polygon (dashed slate)
  const basePts = radarAxes.map((ax, idx) => polarPoint(idx, ax.base));
  drawPolygon(basePts, [0.58, 0.64, 0.72], 1.1, '3 3', [0.94, 0.95, 0.97]);

  // Draw Run A polygon (sky blue)
  const runAPts = radarAxes.map((ax, idx) => polarPoint(idx, ax.a));
  drawPolygon(runAPts, [0.05, 0.65, 0.91], 1.7, '', [0.89, 0.96, 0.99]);

  // Draw Run B polygon (emerald accent)
  const runBPts = radarAxes.map((ax, idx) => polarPoint(idx, ax.b));
  drawPolygon(runBPts, [0.02, 0.59, 0.41], 2.2);

  // Vertex dots for Run A and Run B
  runAPts.forEach((p) => drawCircleFill(p.x, p.y, 2.6, 0.05, 0.65, 0.91));
  runBPts.forEach((p) => drawCircleFill(p.x, p.y, 3.1, 0.02, 0.59, 0.41));

  // Right side of Radar Panel: Legend & Net Radar Delta Summary Box
  const rightX = 358;
  rectFill(rightX, 360, 206, 204, 0.97, 0.98, 0.99);
  rectStroke(rightX, 360, 206, 204, 0.85, 0.89, 0.94, 0.8);

  drawText('RADAR POLYGON LEGEND', rightX + 12, 548, 8.0, 'F3', 0.38, 0.45, 0.54);

  // Legend row 1: Baseline
  drawLine(rightX + 12, 534, rightX + 30, 534, 0.58, 0.64, 0.72, 1.4, '3 2');
  drawText('Unpatched Baseline', rightX + 36, 531, 8.2, 'F1', 0.35, 0.41, 0.49);

  // Legend row 2: Run A
  drawLine(rightX + 12, 518, rightX + 30, 518, 0.05, 0.65, 0.91, 2.0);
  drawCircleFill(rightX + 21, 518, 2.5, 0.05, 0.65, 0.91);
  drawText(truncate(`Run A: ${runA.badge}`, 27), rightX + 36, 515, 8.2, 'F2', 0.01, 0.52, 0.78);

  // Legend row 3: Run B
  drawLine(rightX + 12, 502, rightX + 30, 502, 0.02, 0.59, 0.41, 2.3);
  drawCircleFill(rightX + 21, 502, 2.8, 0.02, 0.59, 0.41);
  drawText(truncate(`Run B: ${runB.badge}`, 27), rightX + 36, 499, 8.2, 'F2', 0.02, 0.52, 0.36);

  drawLine(rightX + 12, 488, rightX + 194, 488, 0.86, 0.89, 0.93, 0.7);
  drawText('NET RADAR DELTA (RUN B vs. RUN A)', rightX + 12, 474, 7.8, 'F3', 0.38, 0.45, 0.54);

  const avgDelta = Math.round(
    radarAxes.reduce((acc, ax) => acc + (ax.b - ax.a), 0) / Math.max(1, radarAxes.length)
  );
  const kpiLines: { label: string; value: string; delta: number }[] = [
    { label: 'Average 6-Axis Radar Delta', value: `${avgDelta >= 0 ? '+' : ''}${avgDelta} pts`, delta: avgDelta },
    { label: 'Performance Score Delta', value: `${perfDiff >= 0 ? '+' : ''}${perfDiff} pts`, delta: perfDiff },
    { label: 'Accessibility Score Delta', value: `${a11yDiff >= 0 ? '+' : ''}${a11yDiff} pts`, delta: a11yDiff },
    { label: 'LCP / CLS / FID Deltas', value: `${lcpDiff >= 0 ? '+' : ''}${lcpDiff} / ${clsDiff >= 0 ? '+' : ''}${clsDiff} / ${fidDiff >= 0 ? '+' : ''}${fidDiff}`, delta: lcpDiff + clsDiff + fidDiff },
  ];

  kpiLines.forEach((item, i) => {
    const rowY = 454 - i * 23;
    drawText(item.label, rightX + 12, rowY, 7.8, 'F1', 0.25, 0.31, 0.4);
    drawText(
      item.value,
      rightX + 12,
      rowY - 10,
      8.6,
      'F3',
      item.delta > 0 ? 0.02 : item.delta < 0 ? 0.78 : 0.35,
      item.delta > 0 ? 0.54 : item.delta < 0 ? 0.18 : 0.41,
      item.delta > 0 ? 0.38 : item.delta < 0 ? 0.24 : 0.49
    );
  });

  // 4. GRANULAR 8-DIMENSION METRIC DELTA TABLE
  drawText('DETAILED METRIC DELTA BREAKDOWN (8 AUDIT DIMENSIONS)', 32, 322, 9.5, 'F2', 0.09, 0.12, 0.18);

  const tableTop = 312;
  const rowH = 27;
  // Table header bar
  rectFill(32, tableTop - 22, 548, 22, 0.93, 0.95, 0.98);
  rectStroke(32, tableTop - 22, 548, 22, 0.82, 0.86, 0.91, 0.8);
  drawText('METRIC / DIMENSION', 42, tableTop - 14, 7.6, 'F3', 0.3, 0.37, 0.46);
  drawText('RUN A (BEFORE -> AFTER)', 242, tableTop - 14, 7.6, 'F3', 0.01, 0.48, 0.72);
  drawText('RUN B (BEFORE -> AFTER)', 374, tableTop - 14, 7.6, 'F3', 0.02, 0.52, 0.36);
  drawText('DELTA (B vs A)', 502, tableTop - 14, 7.6, 'F3', 0.3, 0.37, 0.46);

  const displayRows = rows.slice(0, 8);
  displayRows.forEach((row, idx) => {
    const yBottom = tableTop - 22 - (idx + 1) * rowH;
    if (idx % 2 === 1) {
      rectFill(32, yBottom, 548, rowH, 0.98, 0.99, 1.0);
    }
    rectStroke(32, yBottom, 548, rowH, 0.88, 0.91, 0.94, 0.6);

    drawText(truncate(row.label, 34), 42, yBottom + 14, 8.3, 'F2', 0.1, 0.14, 0.2);
    drawText(row.category.toUpperCase(), 42, yBottom + 5, 6.7, 'F3', 0.48, 0.54, 0.62);

    drawText(
      `${row.runABefore} -> ${row.runAAfter} (+${row.runAGain})`,
      242,
      yBottom + 10,
      8.3,
      'F3',
      0.16,
      0.22,
      0.3
    );

    drawText(
      `${row.runBBefore} -> ${row.runBAfter} (+${row.runBGain})`,
      374,
      yBottom + 10,
      8.3,
      'F3',
      0.02,
      0.5,
      0.35
    );

    const diffLabel =
      row.afterDiff > 0
        ? `+${row.afterDiff} pts`
        : row.afterDiff < 0
          ? `${row.afterDiff} pts`
          : '0 pts';

    const badgeColor: [number, number, number] =
      row.afterDiff > 0
        ? [0.02, 0.54, 0.38]
        : row.afterDiff < 0
          ? [0.8, 0.18, 0.25]
          : [0.42, 0.48, 0.56];
    const badgeBg: [number, number, number] =
      row.afterDiff > 0
        ? [0.91, 0.98, 0.95]
        : row.afterDiff < 0
          ? [0.99, 0.93, 0.94]
          : [0.95, 0.96, 0.97];

    rectFill(500, yBottom + 6, 68, 15, badgeBg[0], badgeBg[1], badgeBg[2]);
    drawText(diffLabel, 512, yBottom + 10.5, 8.0, 'F3', badgeColor[0], badgeColor[1], badgeColor[2]);
  });

  // 5. FOOTER
  drawLine(32, 54, 580, 54, 0.85, 0.88, 0.92, 0.8);
  drawText(
    'Fresnel Code & Lighthouse Audit Comparison  |  Vector Radar Chart Delta Export',
    32,
    38,
    7.6,
    'F3',
    0.42,
    0.49,
    0.58
  );
  drawText(
    `Run A: ${truncate(runA.badge, 24)} vs Run B: ${truncate(runB.badge, 24)}`,
    350,
    38,
    7.6,
    'F3',
    0.42,
    0.49,
    0.58
  );

  // Assemble PDF 1.4 binary
  const streamContent = ops.join('\n') + '\n';
  const encoder = new TextEncoder();
  const streamByteLen = encoder.encode(streamContent).length;

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>',
    `<< /Length ${streamByteLen} >>\nstream\n${streamContent}endstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 0; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const bytes = encoder.encode(pdf);
  return { filename, bytes };
}
