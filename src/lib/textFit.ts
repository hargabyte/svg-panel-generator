export const DEFAULT_FONT_FAMILY = 'Roboto';

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function measureTextSvg(
  text: string,
  fontFamily: string,
  fontSize: number
): { width: number; height: number; ascent: number; descent: number } {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.position = 'absolute';
  svg.style.visibility = 'hidden';
  // Use large dimensions to ensure getBBox works correctly at any font size
  svg.style.width = '10000px';
  svg.style.height = '10000px';
  svg.style.overflow = 'visible';

  const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  textEl.setAttribute('font-family', fontFamily);
  textEl.setAttribute('font-size', String(fontSize));
  textEl.textContent = text;

  svg.appendChild(textEl);
  document.body.appendChild(svg);

  const bbox = textEl.getBBox();
  document.body.removeChild(svg);

  // Validate bbox - fall back to estimates if invalid
  if (!bbox || bbox.width <= 0 || bbox.height <= 0) {
    // Estimate based on typical character metrics
    const estWidth = text.length * fontSize * 0.6;
    const estHeight = fontSize * 1.2;
    return {
      width: estWidth,
      height: estHeight,
      ascent: fontSize * 0.8,
      descent: fontSize * 0.2,
    };
  }

  const ascent = -bbox.y;
  const descent = bbox.height - ascent;
  return { width: bbox.width, height: bbox.height, ascent, descent };
}

export function calculateTextFit(
  text: string,
  fontFamily: string,
  box: { x: number; y: number; width: number; height: number }
): { fontSize: number; x: number; y: number } {
  // Handle empty text or invalid box
  if (!text || box.width <= 0 || box.height <= 0) {
    return { fontSize: 12, x: box.x + box.width / 2, y: box.y + box.height };
  }

  const refSize = 100;
  const measured = measureTextSvg(text, fontFamily, refSize);

  // Validate measured dimensions to prevent division by zero or infinity
  const measuredHeight = measured.height > 0 ? measured.height : refSize * 1.2;
  const measuredWidth = measured.width > 0 ? measured.width : text.length * refSize * 0.6;

  const heightScale = (box.height * 0.99) / measuredHeight;
  const widthScale = (box.width * 0.99) / measuredWidth;
  const scale = Math.min(heightScale, widthScale);

  // Clamp font size to reasonable bounds (1px to 2000px)
  const fontSize = Math.max(1, Math.min(refSize * scale, 2000));

  const final = measureTextSvg(text, fontFamily, fontSize);

  const x = box.x + box.width / 2;
  const boxBottom = box.y + box.height;
  const y = boxBottom - final.descent;

  return { fontSize, x, y };
}
