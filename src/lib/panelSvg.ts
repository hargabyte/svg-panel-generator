import { readFileFromMap } from './fsScan';
import type { ScannedSvgFile } from './fsScan';
import { parseSvgString } from './svgParse';
import { DEFAULT_FONT_FAMILY, calculateTextFit, escapeXml } from './textFit';
import { computeGridLayout, computePanelCount } from './panelLayout';

export interface PanelTextSettings {
  fontFamily: string;
  labelColor: string;
}

export interface PanelContentSettings {
  labelHeightMm: number;
  paddingMm: number;
  showCellBorders: boolean;
}

export interface PanelBuildSettings {
  panelWidthMm: number;
  panelHeightMm: number;
  cellSizeMm: number;
  artWidthMm?: number;   // Exact art width (if provided, used instead of cellSizeMm for artBox)
  artHeightMm?: number;  // Exact art height (if provided, used instead of cellSizeMm for artBox)
  marginMm: number;
  gutterMm: number;
  labelHeightMm: number;
  paddingMm: number;
  showCellBorders: boolean;
  removeOrnamentHole?: boolean;
  addRoundBacker?: boolean;
  roundBackerStrokeWidth?: number;
  fontFamily?: string;
  labelColor?: string;
  layerSettings?: LayerConfig[] | null;  // null = passthrough (no processing)
}

export interface LayerConfig {
  color: string;  // normalized hex color e.g., '#0000ff'
  visibility: 'hidden' | 'show-black' | 'show-color';
  renderMode: 'fill' | 'stroke';
  outputColor?: string;  // custom output color (default: black for show-black, original for show-color)
}

// Default: null means passthrough - show SVG exactly as-is with no modifications
// Only apply layer processing when user explicitly selects a preset
export const DEFAULT_LAYER_SETTINGS: LayerConfig[] | null = null;

// Preset configurations (only used when explicitly selected)
export const LAYER_PRESETS = {
  // Original: No processing - show SVGs exactly as they are in the file
  original: null as LayerConfig[] | null,
  // Standard: Show SVGs with original colors and render modes (preview mode)
  standard: [
    { color: '#0000ff', visibility: 'show-color' as const, renderMode: 'stroke' as const, outputColor: '#0000ff' },
    { color: '#00c100', visibility: 'show-color' as const, renderMode: 'fill' as const, outputColor: '#00c100' },
    { color: '#000000', visibility: 'show-color' as const, renderMode: 'stroke' as const, outputColor: '#000000' },
    { color: '#ff0000', visibility: 'show-color' as const, renderMode: 'stroke' as const, outputColor: '#ff0000' },
  ],
  // Inverted: Hide cut lines, show engrave content as black fill (for laser engraving)
  inverted: [
    { color: '#0000ff', visibility: 'hidden' as const, renderMode: 'fill' as const, outputColor: '#000000' },
    { color: '#00c100', visibility: 'show-color' as const, renderMode: 'fill' as const, outputColor: '#000000' },
    { color: '#000000', visibility: 'show-color' as const, renderMode: 'fill' as const, outputColor: '#000000' },
    { color: '#ff0000', visibility: 'show-color' as const, renderMode: 'stroke' as const, outputColor: '#ff0000' },
  ],
};

export interface BuiltPanels {
  panelSvgs: string[];
  cols: number;
  rows: number;
  capacityPerPanel: number;
}

type Bounds = { x: number; y: number; width: number; height: number };

/**
 * Build panel SVGs from selected files.
 * @param selected - Array of scanned SVG files
 * @param settings - Panel build settings
 * @param fileMap - Map of file paths to File objects for reading content
 */
export async function buildPanelSvgs(
  selected: ScannedSvgFile[],
  settings: PanelBuildSettings,
  fileMap: Map<string, File>
): Promise<BuiltPanels> {
  const fontFamily = settings.fontFamily || DEFAULT_FONT_FAMILY;
  const labelColor = settings.labelColor || '#000000';
  const removeOrnamentHole = settings.removeOrnamentHole ?? false;
  const addRoundBacker = settings.addRoundBacker ?? false;
  const roundBackerStrokeWidth = settings.roundBackerStrokeWidth ?? 0.5;
  const layerSettings = settings.layerSettings ?? DEFAULT_LAYER_SETTINGS;

  const grid = computeGridLayout({
    panelWidthMm: settings.panelWidthMm,
    panelHeightMm: settings.panelHeightMm,
    cellSizeMm: settings.cellSizeMm,
    marginMm: settings.marginMm,
    gutterMm: settings.gutterMm,
  });

  const panelCount = computePanelCount(selected.length, grid.capacityPerPanel);
  if (panelCount <= 0) {
    return { panelSvgs: [], cols: grid.cols, rows: grid.rows, capacityPerPanel: grid.capacityPerPanel };
  }

  const panelSvgs: string[] = [];

  // Build cache key from all processing options
  const processingKey = JSON.stringify({
    layers: layerSettings,
    removeHole: removeOrnamentHole,
    roundBacker: addRoundBacker,
    backerStroke: roundBackerStrokeWidth,
  });

  const cache = new Map<
    string,
    {
      viewBox: { x: number; y: number; width: number; height: number };
      innerContent: string;
      svgText: string;
      innerContentBounds?: Bounds;
      processedContent?: string;
      processedBounds?: Bounds;
      processingKey?: string;
    }
  >();

  for (let panelIndex = 0; panelIndex < panelCount; panelIndex++) {
    const start = panelIndex * grid.capacityPerPanel;
    const end = Math.min(selected.length, start + grid.capacityPerPanel);
    const items = selected.slice(start, end);

    const parts: string[] = [];
    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${settings.panelWidthMm}mm" height="${settings.panelHeightMm}mm" viewBox="0 0 ${settings.panelWidthMm} ${settings.panelHeightMm}">`
    );

    for (let i = 0; i < items.length; i++) {
      const placement = grid.placements[i];
      if (!placement) break;

      const cellX = placement.x;
      const cellY = placement.y;
      const cellS = placement.size;

      const labelHeight = settings.labelHeightMm;
      const padding = settings.paddingMm;

      // Cell is divided into:
      // - art region: [cellY .. cellY + cellS - labelHeight]
      // - label region: [cellY + cellS - labelHeight .. cellY + cellS]
      // Padding is an optional inset inside each region.
      const artRegion = {
        x: cellX,
        y: cellY,
        width: cellS,
        height: Math.max(0, cellS - labelHeight),
      };

      const labelRegion = {
        x: cellX,
        y: cellY + cellS - labelHeight,
        width: cellS,
        height: Math.max(0, labelHeight),
      };

      // Use exact art dimensions if provided, otherwise use artRegion minus padding
      const exactArtW = settings.artWidthMm ?? (artRegion.width - padding * 2);
      const exactArtH = settings.artHeightMm ?? (artRegion.height - padding * 2);

      // Center the art box within the art region
      const artBoxW = Math.max(0, exactArtW);
      const artBoxH = Math.max(0, exactArtH);
      const artBoxX = artRegion.x + (artRegion.width - artBoxW) / 2;
      const artBoxY = artRegion.y + (artRegion.height - artBoxH) / 2;

      const artBox = {
        x: artBoxX,
        y: artBoxY,
        width: artBoxW,
        height: artBoxH,
      };

      // Label box: only apply horizontal padding (labels fill their vertical space)
      // Use a small vertical margin (1mm) to prevent text touching edges
      const labelPadV = Math.min(1, labelRegion.height * 0.1);
      const labelBox = {
        x: labelRegion.x + padding,
        y: labelRegion.y + labelPadV,
        width: Math.max(0, labelRegion.width - padding * 2),
        height: Math.max(0, labelRegion.height - labelPadV * 2),
      };

      if (settings.showCellBorders) {
        parts.push(
          `<rect x="${cellX}" y="${cellY}" width="${cellS}" height="${cellS}" fill="none" stroke="#2563eb" stroke-width="0.2"/>`
        );
      }

      const file = items[i];
      let parsed = cache.get(file.path);
      if (!parsed) {
        // Read file content from the fileMap (browser File API)
        const svgText = await readFileFromMap(fileMap, file.path);
        const base = parseSvgString(svgText);
        parsed = { ...base, svgText };
        cache.set(file.path, parsed);
      }

      const vb = parsed.viewBox;

      // Choose which content we will render and the bounds used for "zoom-to-content".
      let renderInner = parsed.innerContent;
      let renderBounds: Bounds | null = null;

      // ALWAYS process SVGs to inline CSS styles and prevent class name conflicts.
      // When multiple SVGs are combined into one panel, their <style> blocks can have
      // conflicting class definitions (e.g., .st0, .st1 mean different colors in each file).
      // By always processing, we remove <style> blocks and inline the colors directly on elements.
      // The layerSettings, removeOrnamentHole, and addRoundBacker options are handled inside processLayersForPanel.
      const needsProcessing = true;

      if (needsProcessing) {
        if (!parsed.processedContent || parsed.processingKey !== processingKey) {
          parsed.processedContent = processLayersForPanel(parsed.svgText, layerSettings, {
            removeOrnamentHole,
            addRoundBacker,
            roundBackerStrokeWidth,
          });
          parsed.processedBounds = measureInnerContentBounds(vb, parsed.processedContent) ?? undefined;
          parsed.processingKey = processingKey;
        }
        renderInner = parsed.processedContent;
        renderBounds = parsed.processedBounds ?? null;
      }

      // Default bounds: measure the original content once (cached), then fall back to viewBox.
      if (!renderBounds) {
        if (!parsed.innerContentBounds) {
          parsed.innerContentBounds = measureInnerContentBounds(vb, parsed.innerContent) ?? undefined;
        }
        renderBounds = parsed.innerContentBounds ?? null;
      }

      const bounds = renderBounds ?? vb;
      const scale = Math.min(artBox.width / bounds.width, artBox.height / bounds.height);
      const scaledW = bounds.width * scale;
      const scaledH = bounds.height * scale;
      const offsetX = (artBox.width - scaledW) / 2;
      const offsetY = (artBox.height - scaledH) / 2;

      // Use filename (without .svg) as group id for easy selection after ungrouping
      const ornamentId = file.name.replace(/\.svg$/i, '') || `ornament-${i}`;
      const transform = `translate(${artBox.x + offsetX}, ${artBox.y + offsetY}) scale(${scale}) translate(${-bounds.x}, ${-bounds.y})`;
      parts.push(`<g id="${escapeXml(ornamentId)}">`);
      parts.push(`<g transform="${transform}">`);
      parts.push(renderInner);
      parts.push(`</g>`);
      parts.push(`</g>`);

      if (labelBox.width > 0 && labelBox.height > 0) {
        const label = file.parentFolder || '';
        if (label) {
          const fit = calculateTextFit(label, fontFamily, labelBox);
          parts.push(
            `<text x="${fit.x}" y="${fit.y}" font-family="${fontFamily}" font-size="${fit.fontSize}" fill="${labelColor}" text-anchor="middle">${escapeXml(label)}</text>`
          );
        }
      }
    }

    parts.push(`</svg>`);
    panelSvgs.push(parts.join('\n'));
  }

  return { panelSvgs, cols: grid.cols, rows: grid.rows, capacityPerPanel: grid.capacityPerPanel };
}

function isClosedPath(d: string | null): boolean {
  if (!d) return false;
  // If any closepath command exists, treat as closed.
  return /[zZ]\s*$/.test(d) || /[zZ]\b/.test(d);
}

function getSvgViewBox(svg: SVGSVGElement): { x: number; y: number; width: number; height: number } | null {
  const vb = svg.getAttribute('viewBox');
  if (vb) {
    const parts = vb.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((p) => Number.isFinite(p))) {
      const [x, y, width, height] = parts;
      if (width > 0 && height > 0) return { x, y, width, height };
    }
  }
  const wAttr = svg.getAttribute('width');
  const hAttr = svg.getAttribute('height');
  const w = wAttr ? Number.parseFloat(wAttr.replace(/[^\d.+-]/g, '')) : NaN;
  const h = hAttr ? Number.parseFloat(hAttr.replace(/[^\d.+-]/g, '')) : NaN;
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { x: 0, y: 0, width: w, height: h };
  return null;
}

function removeOrnamentHoleIfFound(imported: SVGSVGElement, vb: { x: number; y: number; width: number; height: number }) {
  // Try multiple methods - some SVGs have holes in compound paths, some as standalone elements,
  // and some as part of continuous stroke paths (which can't be easily removed).

  // Method 1: Remove holes from compound paths (subpaths within larger paths)
  removeOrnamentHoleFromPathSubpaths(imported, vb);

  // Method 2: Remove standalone small circle/shape elements that represent holes
  const candidates = Array.from(
    imported.querySelectorAll('circle, ellipse, path, rect, use, polygon')
  );

  type Scored = { el: Element; score: number };
  const scored: Scored[] = [];

  const vbCx = vb.x + vb.width / 2;
  const minDim = Math.min(vb.width, vb.height);

  for (const el of candidates) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'text') continue;

    const bbox = safeGetBBox(el);
    if (!bbox) continue;

    const d = Math.max(bbox.width, bbox.height);
    if (d <= 0 || !Number.isFinite(d)) continue;

    const sizeRatio = d / minDim;
    // TIGHT size range: holes are typically 3-8% of viewBox, never larger than 10%
    // This prevents removing text letters which can be 5-15% of viewBox
    if (sizeRatio < 0.02 || sizeRatio > 0.10) continue;

    const aspect = bbox.width / bbox.height;
    if (!Number.isFinite(aspect) || aspect <= 0) continue;
    // Holes are nearly circular - tighter aspect ratio requirement
    if (aspect < 0.85 || aspect > 1.18) continue;

    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;

    const dx = Math.abs(cx - vbCx) / vb.width;
    const dyTop = (cy - vb.y) / vb.height;

    // STRICT position: hole must be at VERY top (0-15%) and VERY centered (within 10%)
    // This prevents removing letters that are in the upper portion but not at the exact top
    if (dx > 0.10) continue;
    if (dyTop < -0.05 || dyTop > 0.15) continue;

    // Prefer: closer to top + closer to center + more circular + smaller.
    const roundPenalty = Math.abs(1 - aspect);
    const score = dx * 2.0 + dyTop * 2.2 + roundPenalty * 1.2 + sizeRatio * 0.6;

    scored.push({ el, score });
  }

  scored.sort((a, b) => a.score - b.score);

  // Remove up to two best candidates in case the hole is represented by multiple elements (fill + stroke).
  for (let i = 0; i < Math.min(2, scored.length); i++) {
    const bbox = safeGetBBox(scored[i]!.el);
    if (!bbox) continue;
    const cy = bbox.y + bbox.height / 2;
    const dyTop = (cy - vb.y) / vb.height;
    if (dyTop > 0.5) continue;
    scored[i]!.el.remove();
  }

  // Method 3 is handled by coverOrnamentHoleWithBackground, called separately AFTER layer processing
  // because a white cover circle would be removed by layer processing.
}

/**
 * Cover the ornament hole area with a background-colored filled circle.
 * This is a fallback for SVGs where the hole is part of a continuous stroke path
 * and can't be removed without complex path editing.
 *
 * This function is called AFTER layer processing, so it checks inline stroke attributes.
 */
function coverOrnamentHoleWithBackground(
  imported: SVGSVGElement,
  vb: { x: number; y: number; width: number; height: number }
): void {
  const minDim = Math.min(vb.width, vb.height);
  const vbCx = vb.x + vb.width / 2;

  // Find paths that pass through the top-center hole region
  // The typical hole is at the very top, centered, and about 3-8% of the viewBox size
  const holeRegion = {
    cx: vbCx,
    cy: vb.y + vb.height * 0.06, // ~6% from top
    radius: minDim * 0.05, // ~5% of min dimension
  };

  // Look for stroke paths that have geometry in the hole region
  // After layer processing, stroke is set as inline attribute
  const paths = Array.from(imported.querySelectorAll('path'));
  let foundHoleGeometry = false;

  for (const pathEl of paths) {
    const d = pathEl.getAttribute('d');
    if (!d) continue;

    // Check if this path has stroke (visible stroke, not 'none')
    const stroke = pathEl.getAttribute('stroke');
    if (!stroke || stroke.toLowerCase() === 'none') continue;

    // Measure if this path has geometry in the hole region
    const bbox = safeGetBBox(pathEl);
    if (!bbox) continue;

    // Path must extend into the top portion where the hole is
    if (bbox.y > vb.y + vb.height * 0.15) continue; // Must reach top 15%

    // Path must be large (it's probably the outer cut line)
    const pathSizeRatio = Math.max(bbox.width, bbox.height) / minDim;
    if (pathSizeRatio < 0.7) continue; // Must be at least 70% of viewBox

    foundHoleGeometry = true;
    break;
  }

  if (!foundHoleGeometry) return;

  // Create a filled circle to cover the hole area
  // Use white or a background color - this will hide the stroke in that region
  const coverCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  coverCircle.setAttribute('cx', String(holeRegion.cx));
  coverCircle.setAttribute('cy', String(holeRegion.cy));
  coverCircle.setAttribute('r', String(holeRegion.radius));
  coverCircle.setAttribute('fill', '#ffffff'); // White to match typical panel background
  coverCircle.setAttribute('stroke', 'none');
  coverCircle.setAttribute('data-hole-cover', 'true'); // Mark for identification

  // Insert at the end so it draws on top
  imported.appendChild(coverCircle);
}

function removeOrnamentHoleFromPathSubpaths(
  imported: SVGSVGElement,
  vb: { x: number; y: number; width: number; height: number }
): boolean {
  const vbCx = vb.x + vb.width / 2;
  const minDim = Math.min(vb.width, vb.height);

  // Collect ALL hole candidates from ALL paths
  type HoleCandidate = { pathEl: SVGPathElement; segIndex: number; score: number };
  const allCandidates: HoleCandidate[] = [];

  const paths = Array.from(imported.querySelectorAll('path'));
  for (const pathEl of paths) {
    const d = pathEl.getAttribute('d');
    if (!d) continue;

    const segments = splitPathIntoSubpaths(d);
    if (segments.length < 2) continue;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      if (!isClosedPath(seg)) continue;

      const bbox = measurePathBBoxForD(imported, seg);
      if (!bbox) continue;

      const maxDim = Math.max(bbox.width, bbox.height);
      const sizeRatio = maxDim / minDim;
      // TIGHT size range: holes are typically 3-8% of viewBox
      if (sizeRatio < 0.02 || sizeRatio > 0.10) continue;

      const aspect = bbox.width / bbox.height;
      // Holes are nearly circular - tight aspect ratio
      if (!Number.isFinite(aspect) || aspect < 0.85 || aspect > 1.18) continue;

      const cx = bbox.x + bbox.width / 2;
      const cy = bbox.y + bbox.height / 2;

      const dx = Math.abs(cx - vbCx) / vb.width;
      const dyTop = (cy - vb.y) / vb.height;

      // STRICT position: hole must be at VERY top and VERY centered
      // This prevents removing letter inner holes (like in D, O, etc.)
      if (dx > 0.10) continue;
      if (dyTop < -0.05 || dyTop > 0.15) continue;

      const roundPenalty = Math.abs(1 - aspect);
      const score = dx * 2.0 + dyTop * 2.4 + roundPenalty * 1.2 + sizeRatio * 0.5;

      allCandidates.push({ pathEl, segIndex: i, score });
    }
  }

  if (allCandidates.length === 0) return false;

  // Sort by score (best first) and remove holes from each path
  // Group by path element to handle multiple holes in same path correctly
  const holesByPath = new Map<SVGPathElement, number[]>();

  // Sort candidates by score
  allCandidates.sort((a, b) => a.score - b.score);

  // Take top candidates (at most 3 to avoid removing too much)
  const toRemove = allCandidates.slice(0, 3);

  for (const candidate of toRemove) {
    const existing = holesByPath.get(candidate.pathEl) || [];
    existing.push(candidate.segIndex);
    holesByPath.set(candidate.pathEl, existing);
  }

  // Now remove the hole subpaths from each affected path
  let removed = false;
  for (const [pathEl, segIndices] of holesByPath) {
    const d = pathEl.getAttribute('d');
    if (!d) continue;

    const segments = splitPathIntoSubpaths(d);
    if (segments.length < 2) continue;

    // Sort indices in descending order to remove from end first (preserves earlier indices)
    const sortedIndices = [...segIndices].sort((a, b) => b - a);

    for (const idx of sortedIndices) {
      if (idx < segments.length) {
        segments.splice(idx, 1);
        removed = true;
      }
    }

    pathEl.setAttribute('d', segments.join(' '));
  }

  return removed;
}

function splitPathIntoSubpaths(d: string): string[] {
  // Split at each move command (M/m). Illustrator exports typically encode subpaths as absolute M...Z blocks.
  // Keep the M in the segment using a lookahead.
  return d
    .trim()
    .split(/(?=[Mm])/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function measurePathBBoxForD(imported: SVGSVGElement, d: string): DOMRect | null {
  const temp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  temp.setAttribute('d', d);
  temp.setAttribute('fill', 'none');
  temp.setAttribute('stroke', 'none');

  imported.appendChild(temp);
  let bbox: DOMRect | null = null;
  try {
    bbox = temp.getBBox();
  } catch {
    bbox = null;
  } finally {
    temp.remove();
  }
  return bbox;
}

function measureInnerContentBounds(
  vb: { x: number; y: number; width: number; height: number },
  innerContent: string
): Bounds | null {
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-99999px';
  container.style.top = '-99999px';
  container.style.visibility = 'hidden';
  document.body.appendChild(container);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
  svg.setAttribute('width', String(vb.width));
  svg.setAttribute('height', String(vb.height));
  svg.innerHTML = innerContent;
  container.appendChild(svg);

  let bbox: DOMRect | null = null;
  try {
    bbox = svg.getBBox();
  } catch {
    bbox = null;
  } finally {
    document.body.removeChild(container);
  }

  if (!bbox || !Number.isFinite(bbox.width) || !Number.isFinite(bbox.height)) return null;
  if (bbox.width <= 0 || bbox.height <= 0) return null;

  return { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
}

function safeGetBBox(el: Element): DOMRect | null {
  try {
    const bbox = (el as unknown as SVGGraphicsElement).getBBox();
    if (!bbox) return null;
    if (!Number.isFinite(bbox.x) || !Number.isFinite(bbox.y) || !Number.isFinite(bbox.width) || !Number.isFinite(bbox.height)) return null;
    return bbox;
  } catch {
    return null;
  }
}

/**
 * Normalize a color to lowercase hex format.
 * Handles: hex (#fff, #ffffff), rgb(), named colors
 */
function normalizeColorToHex(color: string): string {
  const c = color.trim().toLowerCase();

  // Already hex
  if (c.startsWith('#')) {
    // Expand short hex
    if (c.length === 4) {
      return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    }
    return c;
  }

  // Named colors
  const namedColors: Record<string, string> = {
    'black': '#000000',
    'white': '#ffffff',
    'red': '#ff0000',
    'green': '#00ff00',
    'blue': '#0000ff',
    'lime': '#00ff00',
    'none': 'none',
    'transparent': 'none',
  };
  if (namedColors[c]) return namedColors[c];

  // rgb() format
  const rgbMatch = c.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
    const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
    const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }

  return c;
}

/**
 * Check if two colors are similar (within tolerance for slight variations).
 */
function colorsMatch(color1: string, color2: string): boolean {
  const c1 = normalizeColorToHex(color1);
  const c2 = normalizeColorToHex(color2);

  if (c1 === c2) return true;

  // Handle near-matches (e.g., #00c100 vs #00C100)
  if (c1.toLowerCase() === c2.toLowerCase()) return true;

  // Parse and compare with tolerance
  const parse = (hex: string): [number, number, number] | null => {
    const match = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!match) return null;
    return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
  };

  const rgb1 = parse(c1);
  const rgb2 = parse(c2);
  if (!rgb1 || !rgb2) return false;

  // Allow tolerance of 10 for each channel
  const tolerance = 10;
  return Math.abs(rgb1[0] - rgb2[0]) <= tolerance &&
         Math.abs(rgb1[1] - rgb2[1]) <= tolerance &&
         Math.abs(rgb1[2] - rgb2[2]) <= tolerance;
}

interface ParsedStyleRule {
  fill?: string;
  stroke?: string;
  strokeWidth?: string;
}

/**
 * Parse SVG <style> block to extract class -> color mappings.
 */
function parseSvgStyleBlock(svgText: string): Map<string, ParsedStyleRule> {
  const result = new Map<string, ParsedStyleRule>();

  // Extract style content
  const styleMatch = svgText.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  if (!styleMatch) return result;

  const cssText = styleMatch[1];

  // Parse CSS rules like: .st0{fill:#00C100;} .st1{fill:none;stroke:#0000FF;stroke-width:0.5;}
  const ruleRegex = /\.([a-zA-Z0-9_-]+)\s*\{([^}]+)\}/g;
  let match;

  while ((match = ruleRegex.exec(cssText)) !== null) {
    const className = match[1];
    const declarations = match[2];

    const rule: ParsedStyleRule = {};

    // Extract fill
    const fillMatch = declarations.match(/fill\s*:\s*([^;]+)/i);
    if (fillMatch) {
      rule.fill = fillMatch[1].trim();
    }

    // Extract stroke
    const strokeMatch = declarations.match(/(?:^|[^-])stroke\s*:\s*([^;]+)/i);
    if (strokeMatch) {
      rule.stroke = strokeMatch[1].trim();
    }

    // Extract stroke-width
    const strokeWidthMatch = declarations.match(/stroke-width\s*:\s*([^;]+)/i);
    if (strokeWidthMatch) {
      rule.strokeWidth = strokeWidthMatch[1].trim();
    }

    result.set(className, rule);
  }

  return result;
}

/**
 * Get the effective fill/stroke colors for an element by checking class and inline styles.
 */
function getElementColors(el: Element, styleMap: Map<string, ParsedStyleRule>): { fill: string | null; stroke: string | null; strokeWidth: string | null } {
  let fill: string | null = null;
  let stroke: string | null = null;
  let strokeWidth: string | null = null;

  // Check class attribute
  const classAttr = el.getAttribute('class');
  if (classAttr) {
    const classes = classAttr.split(/\s+/);
    for (const cls of classes) {
      const rule = styleMap.get(cls);
      if (rule) {
        if (rule.fill) fill = rule.fill;
        if (rule.stroke) stroke = rule.stroke;
        if (rule.strokeWidth) strokeWidth = rule.strokeWidth;
      }
    }
  }

  // Check inline style (overrides class)
  const styleAttr = el.getAttribute('style');
  if (styleAttr) {
    const fillMatch = styleAttr.match(/fill\s*:\s*([^;]+)/i);
    if (fillMatch) fill = fillMatch[1].trim();

    const strokeMatch = styleAttr.match(/(?:^|[^-])stroke\s*:\s*([^;]+)/i);
    if (strokeMatch) stroke = strokeMatch[1].trim();

    const strokeWidthMatch = styleAttr.match(/stroke-width\s*:\s*([^;]+)/i);
    if (strokeWidthMatch) strokeWidth = strokeWidthMatch[1].trim();
  }

  // Check direct attributes (lowest priority after CSS)
  if (!fill && el.getAttribute('fill')) fill = el.getAttribute('fill');
  if (!stroke && el.getAttribute('stroke')) stroke = el.getAttribute('stroke');
  if (!strokeWidth && el.getAttribute('stroke-width')) strokeWidth = el.getAttribute('stroke-width');

  return { fill, stroke, strokeWidth };
}

/**
 * Find matching layer config for a color.
 */
function findLayerConfig(color: string, layers: LayerConfig[]): LayerConfig | null {
  const normalized = normalizeColorToHex(color);
  if (normalized === 'none' || !normalized) return null;

  for (const layer of layers) {
    if (colorsMatch(normalized, layer.color)) {
      return layer;
    }
  }
  return null;
}

interface ProcessingOptions {
  removeOrnamentHole?: boolean;
  addRoundBacker?: boolean;
  roundBackerStrokeWidth?: number;
}

/**
 * Process SVG content according to layer settings.
 * This is the main function that handles all layer-based transformations.
 * When layers is null, only ornament hole removal and round backer are applied (passthrough mode).
 */
export function processLayersForPanel(svgText: string, layers: LayerConfig[] | null, options: ProcessingOptions = {}): string {
  const { removeOrnamentHole = false, addRoundBacker = false, roundBackerStrokeWidth = 0.5 } = options;

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) return svgText;

  const svg = doc.querySelector('svg');
  if (!svg) return svgText;

  // Parse the style block
  const styleMap = parseSvgStyleBlock(svgText);

  const viewBox = getSvgViewBox(svg);

  // Create container for processing
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-99999px';
  container.style.top = '-99999px';
  container.style.visibility = 'hidden';
  document.body.appendChild(container);

  const imported = document.importNode(svg, true) as SVGSVGElement;
  if (viewBox) {
    imported.setAttribute('width', String(viewBox.width));
    imported.setAttribute('height', String(viewBox.height));
  } else {
    imported.setAttribute('width', '1000');
    imported.setAttribute('height', '1000');
  }
  container.appendChild(imported);

  // IMPORTANT: Handle ornament hole removal FIRST, before removing style block
  // This ensures the path structure is intact and CSS classes are still available
  if (removeOrnamentHole && viewBox) {
    removeOrnamentHoleIfFound(imported, viewBox);
  }

  // IMPORTANT: Detect cut line bbox BEFORE processing/removing elements
  // This is needed for round backer positioning when blue layer is hidden (Inverted mode)
  let savedCutLineBbox: { x: number; y: number; width: number; height: number } | null = null;
  if (addRoundBacker && viewBox) {
    savedCutLineBbox = detectCutLineBbox(imported, styleMap);
  }

  // ALWAYS remove the style block and inline styles to prevent CSS class conflicts
  // When multiple SVGs are combined into one panel, they may have conflicting class names
  // (e.g., .st0, .st1) that override each other. Inlining styles fixes this.
  const styleEl = imported.querySelector('style');
  if (styleEl) styleEl.remove();

  // Process all shape elements
  const candidates = imported.querySelectorAll(
    'path, rect, circle, ellipse, polygon, polyline, line, text, use, g'
  );

  const elementsToRemove: Element[] = [];

  candidates.forEach((el) => {
    // Skip groups, process their children
    if (el.tagName.toLowerCase() === 'g') return;

    const colors = getElementColors(el, styleMap);

    // Remove class and style attributes - we'll apply inline styles
    el.removeAttribute('class');
    el.removeAttribute('style');

    // PASSTHROUGH MODE: Just inline the original styles without any filtering
    if (layers === null) {
      // Apply fill if present
      if (colors.fill) {
        el.setAttribute('fill', colors.fill);
      }
      // Apply stroke if present
      if (colors.stroke) {
        el.setAttribute('stroke', colors.stroke);
      }
      // Apply stroke-width if present
      if (colors.strokeWidth) {
        el.setAttribute('stroke-width', colors.strokeWidth);
      }
      return; // Done - no filtering in passthrough mode
    }

    // LAYER PROCESSING MODE: Filter and transform colors based on layer settings
    // Determine the primary color for this element
    let primaryColor: string | null = null;
    let hasFill = false;
    let hasStroke = false;

    if (colors.fill && colors.fill.toLowerCase() !== 'none') {
      primaryColor = colors.fill;
      hasFill = true;
    }
    if (colors.stroke && colors.stroke.toLowerCase() !== 'none') {
      if (!primaryColor) primaryColor = colors.stroke;
      hasStroke = true;
    }

    if (!primaryColor) {
      // No visible color, keep element as-is (might have descendants)
      return;
    }

    // Find layer config for this color
    // IMPORTANT: Check both fill and stroke colors - an element might have
    // fill="white" stroke="#ff0000" where we need to match the red stroke
    let layerConfig = findLayerConfig(primaryColor, layers);

    // If primary color (fill) didn't match, try the stroke color
    if (!layerConfig && hasStroke && colors.stroke && colors.stroke.toLowerCase() !== 'none') {
      const strokeConfig = findLayerConfig(colors.stroke, layers);
      if (strokeConfig) {
        layerConfig = strokeConfig;
        primaryColor = colors.stroke;
      }
    }

    if (!layerConfig) {
      // No config for this color - hide by default if not in standard colors
      elementsToRemove.push(el);
      return;
    }

    // Handle visibility
    if (layerConfig.visibility === 'hidden') {
      elementsToRemove.push(el);
      return;
    }

    // Determine target color - use outputColor if specified, otherwise default based on visibility
    let targetColor: string;
    if (layerConfig.outputColor) {
      targetColor = layerConfig.outputColor;
    } else if (layerConfig.visibility === 'show-black') {
      targetColor = '#000000';
    } else {
      targetColor = normalizeColorToHex(primaryColor);
    }

    // Apply render mode
    if (layerConfig.renderMode === 'fill') {
      // Fill mode: convert everything to filled shapes
      if (hasFill) {
        el.setAttribute('fill', targetColor);
      } else if (hasStroke) {
        // Convert stroke to fill for closed shapes
        const tag = el.tagName.toLowerCase();
        const canFill = tag === 'circle' || tag === 'ellipse' || tag === 'rect' || tag === 'polygon' ||
                       (tag === 'path' && isClosedPath((el as SVGPathElement).getAttribute('d')));
        if (canFill) {
          el.setAttribute('fill', targetColor);
        } else {
          // Keep as stroke for open paths
          el.setAttribute('fill', 'none');
          el.setAttribute('stroke', targetColor);
          el.setAttribute('stroke-width', colors.strokeWidth || '0.5');
        }
      }
      el.setAttribute('stroke', 'none');
    } else {
      // Stroke mode: convert fills to strokes (hollow)
      if (hasFill) {
        el.setAttribute('fill', 'none');
        el.setAttribute('stroke', targetColor);
        el.setAttribute('stroke-width', colors.strokeWidth || '1');
      } else {
        el.setAttribute('fill', 'none');
        el.setAttribute('stroke', targetColor);
        el.setAttribute('stroke-width', colors.strokeWidth || '0.5');
      }
    }
  });

  // Remove elements marked for deletion (only populated in layer processing mode)
  elementsToRemove.forEach(el => el.remove());

  // Clean up empty groups (only relevant after layer processing removes elements)
  if (layers !== null) {
    imported.querySelectorAll('g').forEach((g) => {
      if (!g.querySelector('path, rect, circle, ellipse, polygon, polyline, line, text, use')) {
        g.remove();
      }
    });
  }

  // Handle round backer outline
  if (addRoundBacker && viewBox) {
    addRoundBackerOutline(imported, viewBox, styleMap, roundBackerStrokeWidth, savedCutLineBbox);
  }

  // If ornament hole removal is requested but no round backer, add a cover circle as fallback
  // This handles SVGs where the hole is part of a continuous stroke path (can't be removed without path editing)
  if (removeOrnamentHole && !addRoundBacker && viewBox) {
    coverOrnamentHoleWithBackground(imported, viewBox);
  }

  const inner = imported.innerHTML;
  document.body.removeChild(container);
  return inner;
}

/**
 * Detect the blue cut line's bounding box before layer processing removes it.
 * This is called BEFORE elements are removed so we can use the bbox for round backer positioning.
 */
function detectCutLineBbox(
  imported: SVGSVGElement,
  styleMap: Map<string, ParsedStyleRule>
): { x: number; y: number; width: number; height: number } | null {
  const cutLineColor = '#0000ff';
  const candidates = Array.from(imported.querySelectorAll('circle, ellipse, path'));

  let bestBbox: { x: number; y: number; width: number; height: number } | null = null;

  for (const el of candidates) {
    let stroke: string | null = null;

    // Check class-based style
    const classAttr = el.getAttribute('class');
    if (classAttr) {
      const classes = classAttr.split(/\s+/);
      for (const cls of classes) {
        const rule = styleMap.get(cls);
        if (rule?.stroke) stroke = rule.stroke;
      }
    }

    // Check inline style
    const styleAttr = el.getAttribute('style');
    if (styleAttr) {
      const strokeMatch = styleAttr.match(/(?:^|[^-])stroke\s*:\s*([^;]+)/i);
      if (strokeMatch) stroke = strokeMatch[1].trim();
    }

    // Check direct attribute
    if (!stroke) stroke = el.getAttribute('stroke');

    if (!stroke) continue;

    const normalizedStroke = normalizeColorToHex(stroke);
    if (!colorsMatch(normalizedStroke, cutLineColor)) continue;

    const bbox = safeGetBBox(el);
    if (!bbox || bbox.width <= 0) continue;

    // Prefer the largest blue element (usually the outer cut circle)
    if (!bestBbox || bbox.width > bestBbox.width) {
      bestBbox = { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
    }
  }

  return bestBbox;
}

/**
 * Add a centered round backer outline, replacing the original cut line.
 * This is used for converting ornaments to magnets.
 */
function addRoundBackerOutline(
  imported: SVGSVGElement,
  vb: { x: number; y: number; width: number; height: number },
  styleMap: Map<string, ParsedStyleRule>,
  strokeWidth: number = 0.5,
  preCalculatedBbox: { x: number; y: number; width: number; height: number } | null = null
): void {
  // Use pre-calculated bbox if available (needed when blue layer is hidden in Inverted mode)
  let cutBbox = preCalculatedBbox;
  let cutElement: Element | null = null;

  // If no pre-calculated bbox, try to find the cut line now
  if (!cutBbox) {
    const cutLineColor = '#0000ff';
    const candidates = Array.from(imported.querySelectorAll('circle, ellipse, path'));

    for (const el of candidates) {
      let stroke: string | null = null;

      // Check class-based style
      const classAttr = el.getAttribute('class');
      if (classAttr) {
        const classes = classAttr.split(/\s+/);
        for (const cls of classes) {
          const rule = styleMap.get(cls);
          if (rule?.stroke) stroke = rule.stroke;
        }
      }

      // Check inline style
      const styleAttr = el.getAttribute('style');
      if (styleAttr) {
        const strokeMatch = styleAttr.match(/(?:^|[^-])stroke\s*:\s*([^;]+)/i);
        if (strokeMatch) stroke = strokeMatch[1].trim();
      }

      // Check direct attribute
      if (!stroke) stroke = el.getAttribute('stroke');

      if (!stroke) continue;

      const normalizedStroke = normalizeColorToHex(stroke);
      if (!colorsMatch(normalizedStroke, cutLineColor)) continue;

      const bbox = safeGetBBox(el);
      if (!bbox || bbox.width <= 0) continue;

      // Prefer the largest blue element
      if (!cutBbox || bbox.width > cutBbox.width) {
        cutElement = el;
        cutBbox = { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
      }
    }
  }

  if (!cutBbox) {
    // No cut line found, create a circle based on viewBox
    const diameter = Math.min(vb.width, vb.height) * 0.95;
    const cx = vb.x + vb.width / 2;
    const cy = vb.y + vb.height / 2;

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', String(cx));
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', String(diameter / 2));
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', '#000000');
    circle.setAttribute('stroke-width', String(strokeWidth));
    imported.appendChild(circle);
    return;
  }

  // Use the cut element's WIDTH as the diameter (not max) since the height includes the hanging tab
  // The circular body of the ornament is approximately as wide as it is tall (minus the tab)
  const diameter = cutBbox.width;

  // Center the new circle on the circular body, not the full bbox
  // The circular body sits at the bottom of the bbox, with the tab extending above
  // So the circle center is: bottom of bbox minus half the circle diameter
  const cx = cutBbox.x + cutBbox.width / 2;
  const cy = cutBbox.y + cutBbox.height - diameter / 2;

  // Remove the original cut element if we found one (may not exist if already removed by layer processing)
  if (cutElement) {
    cutElement.remove();
  }

  // Also remove any other blue elements (like the hanging hole part of the cut line)
  // These may already be removed by layer processing in Inverted mode
  const blueColor = '#0000ff';
  const allBlueElements = Array.from(imported.querySelectorAll('circle, ellipse, path, line'));
  for (const el of allBlueElements) {
    let stroke: string | null = null;

    const classAttr = el.getAttribute('class');
    if (classAttr) {
      const classes = classAttr.split(/\s+/);
      for (const cls of classes) {
        const rule = styleMap.get(cls);
        if (rule?.stroke) stroke = rule.stroke;
      }
    }

    const styleAttr = el.getAttribute('style');
    if (styleAttr) {
      const strokeMatch = styleAttr.match(/(?:^|[^-])stroke\s*:\s*([^;]+)/i);
      if (strokeMatch) stroke = strokeMatch[1].trim();
    }

    if (!stroke) stroke = el.getAttribute('stroke');

    if (stroke && colorsMatch(normalizeColorToHex(stroke), blueColor)) {
      el.remove();
    }
  }

  // Create the new centered circle
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', String(cx));
  circle.setAttribute('cy', String(cy));
  circle.setAttribute('r', String(diameter / 2));
  circle.setAttribute('fill', 'none');
  circle.setAttribute('stroke', '#000000');
  circle.setAttribute('stroke-width', String(strokeWidth));
  imported.appendChild(circle);
}

/**
 * Detect all unique colors used in SVG files.
 * Useful for building dynamic layer settings UI.
 */
export function detectSvgColors(svgText: string): string[] {
  const colors = new Set<string>();
  const styleMap = parseSvgStyleBlock(svgText);

  // Colors from style block
  styleMap.forEach((rule) => {
    if (rule.fill && rule.fill.toLowerCase() !== 'none') {
      colors.add(normalizeColorToHex(rule.fill));
    }
    if (rule.stroke && rule.stroke.toLowerCase() !== 'none') {
      colors.add(normalizeColorToHex(rule.stroke));
    }
  });

  return Array.from(colors).filter(c => c && c !== 'none');
}

/**
 * Get the dimensions of an SVG file in mm.
 * Web version - reads from File object instead of file path.
 *
 * IMPORTANT: Measures the ACTUAL CONTENT BOUNDS (getBBox), not just viewBox.
 * This ensures the detected dimensions match what buildPanelSvgs() uses for scaling.
 * The viewBox might be larger than the content (e.g., square viewBox with non-square content).
 */
export async function getSvgFileDimensions(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const svgText = await file.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg) return null;

    // Convert px/pt/unitless to mm using 72 DPI (Adobe Illustrator / xTool standard)
    // Note: Different tools use different DPIs (Illustrator=72, Inkscape=96, old SVG spec=90)
    // Using 72 DPI matches xTool's interpretation of Adobe-created SVGs
    const PIXELS_TO_MM = 25.4 / 72;

    // Get viewBox for setting up measurement container
    const vbAttr = svg.getAttribute('viewBox');
    let vb = { x: 0, y: 0, width: 1000, height: 1000 };
    if (vbAttr) {
      const parts = vbAttr.split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts.every((p) => Number.isFinite(p))) {
        vb = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
      }
    }
    // MEASURE ACTUAL CONTENT BOUNDS by rendering to DOM
    // This matches what buildPanelSvgs() does with measureInnerContentBounds()
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-99999px';
    container.style.top = '-99999px';
    container.style.visibility = 'hidden';
    document.body.appendChild(container);

    const imported = document.importNode(svg, true) as SVGSVGElement;
    imported.setAttribute('width', String(vb.width));
    imported.setAttribute('height', String(vb.height));
    container.appendChild(imported);

    let contentBounds: { width: number; height: number } | null = null;
    try {
      const bbox = imported.getBBox();
      if (bbox && bbox.width > 0 && bbox.height > 0) {
        contentBounds = {
          width: bbox.width * PIXELS_TO_MM,
          height: bbox.height * PIXELS_TO_MM
        };
      }
    } catch {
      // getBBox can fail on malformed SVGs
    } finally {
      document.body.removeChild(container);
    }

    if (contentBounds) {
      return contentBounds;
    }

    // FALLBACK: Use viewBox if content measurement failed
    if (vb.width > 0 && vb.height > 0) {
      return {
        width: vb.width * PIXELS_TO_MM,
        height: vb.height * PIXELS_TO_MM
      };
    }

    return null;
  } catch {
    return null;
  }
}
