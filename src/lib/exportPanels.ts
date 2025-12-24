/**
 * Browser-based export using download links.
 * All processing happens client-side - no files are uploaded anywhere.
 */

function padIndex(i: number, total: number): string {
  const width = Math.max(3, String(total).length);
  return String(i).padStart(width, '0');
}

/**
 * Generate the list of file names that would be created
 */
export function generateExportFileNames(baseName: string, panelCount: number): string[] {
  const fileNames: string[] = [];
  for (let i = 0; i < panelCount; i++) {
    const suffix = panelCount > 1 ? `_${padIndex(i + 1, panelCount)}` : '';
    fileNames.push(`${baseName}${suffix}.svg`);
  }
  return fileNames;
}

/**
 * Download a single SVG file via browser download
 */
function downloadSvgFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Download multiple SVG files with a delay between each.
 * This prevents browser download blocking when downloading many files.
 */
export async function downloadPanelSvgs(
  panelSvgs: string[],
  baseName: string,
  delayMs: number = 150
): Promise<string[]> {
  const fileNames = generateExportFileNames(baseName, panelSvgs.length);

  for (let i = 0; i < panelSvgs.length; i++) {
    const content = panelSvgs[i];
    const fileName = fileNames[i];

    if (content && fileName) {
      downloadSvgFile(content, fileName);

      // Add delay between downloads to prevent browser blocking
      if (i < panelSvgs.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  return fileNames;
}

/**
 * Download all panels as a single combined file (optional)
 * Useful for when the user wants everything in one download
 */
export function downloadCombinedSvg(panelSvgs: string[], baseName: string): void {
  // For combined download, we just concatenate the SVGs with comments between them
  const combined = panelSvgs.map((svg, i) =>
    `<!-- Panel ${i + 1} of ${panelSvgs.length} -->\n${svg}`
  ).join('\n\n');

  downloadSvgFile(combined, `${baseName}_combined.svg`);
}
