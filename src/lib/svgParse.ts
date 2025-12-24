export interface ParsedSvg {
  viewBox: { x: number; y: number; width: number; height: number };
  innerContent: string;
}

function parseNumber(s: string | null | undefined): number | null {
  if (!s) return null;
  const n = Number.parseFloat(s.replace(/[^\d.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function parseSvgString(svgContent: string): ParsedSvg {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgContent, 'image/svg+xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Invalid SVG: parse error');
  }

  const svg = doc.querySelector('svg');
  if (!svg) {
    throw new Error('Invalid SVG: missing <svg>');
  }

  let x = 0;
  let y = 0;
  let width = 100;
  let height = 100;

  const viewBox = svg.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((p) => Number.isFinite(p))) {
      [x, y, width, height] = parts;
    }
  } else {
    const wAttr = parseNumber(svg.getAttribute('width'));
    const hAttr = parseNumber(svg.getAttribute('height'));
    if (wAttr) width = wAttr;
    if (hAttr) height = hAttr;
  }

  return {
    viewBox: { x, y, width, height },
    innerContent: svg.innerHTML,
  };
}
