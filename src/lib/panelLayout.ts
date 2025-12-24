export interface PanelLayoutSettings {
  panelWidthMm: number;
  panelHeightMm: number;
  cellSizeMm: number;
  marginMm: number;
  gutterMm: number;
}

export interface GridLayout {
  cols: number;
  rows: number;
  capacityPerPanel: number;
  placements: Array<{ indexInPanel: number; x: number; y: number; size: number }>;
}

export function computeGridLayout(settings: PanelLayoutSettings): GridLayout {
  const { panelWidthMm, panelHeightMm, cellSizeMm, marginMm, gutterMm } = settings;

  const usableW = panelWidthMm - marginMm * 2;
  const usableH = panelHeightMm - marginMm * 2;

  const cols = Math.floor((usableW + gutterMm) / (cellSizeMm + gutterMm));
  const rows = Math.floor((usableH + gutterMm) / (cellSizeMm + gutterMm));
  const capacityPerPanel = Math.max(0, cols * rows);

  const placements: GridLayout['placements'] = [];
  if (cols > 0 && rows > 0) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const indexInPanel = r * cols + c;
        const x = marginMm + c * (cellSizeMm + gutterMm);
        const y = marginMm + r * (cellSizeMm + gutterMm);
        placements.push({ indexInPanel, x, y, size: cellSizeMm });
      }
    }
  }

  return { cols, rows, capacityPerPanel, placements };
}

export function computePanelCount(itemCount: number, capacityPerPanel: number): number {
  if (capacityPerPanel <= 0) return 0;
  return Math.ceil(itemCount / capacityPerPanel);
}
