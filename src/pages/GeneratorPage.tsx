import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScanResult } from '../lib/fsScan';
import { scanFromDataTransfer } from '../lib/fsScan';
import { computeGridLayout, computePanelCount } from '../lib/panelLayout';
import { buildPanelSvgs, LAYER_PRESETS, getSvgFileDimensions, type LayerConfig } from '../lib/panelSvg';
import { downloadPanelSvgs } from '../lib/exportPanels';
import { getBasename, getBasenameNoExt, getNthParentFolderName, getParentDir } from '../lib/pathUtils';

export default function GeneratorPage() {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      return localStorage.getItem('svgPanelGeneratorTheme') === 'dark';
    } catch {
      return false;
    }
  });
  const [rootFolder, setRootFolder] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  // Drag-and-drop state
  const [isDragging, setIsDragging] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement | null>(null);

  // Use string state for inputs to allow empty fields, parse to number for calculations
  const [panelWidthMmRaw, setPanelWidthMmRaw] = useState('300');
  const [panelHeightMmRaw, setPanelHeightMmRaw] = useState('300');
  const [artWidthMmRaw, setArtWidthMmRaw] = useState('50');   // SVG content width (auto-detected from files)
  const [artHeightMmRaw, setArtHeightMmRaw] = useState('50'); // SVG content height (auto-detected from files)
  const [aspectLocked, setAspectLocked] = useState(true);
  const [gutterMmRaw, setGutterMmRaw] = useState('0');
  const [labelHeightMmRaw, setLabelHeightMmRaw] = useState('10');
  const [paddingMmRaw, setPaddingMmRaw] = useState('0');

  // Parse raw values to numbers (empty or invalid → 0)
  const panelWidthMm = parseFloat(panelWidthMmRaw) || 0;
  const panelHeightMm = parseFloat(panelHeightMmRaw) || 0;
  const artWidthMm = parseFloat(artWidthMmRaw) || 0;
  const artHeightMm = parseFloat(artHeightMmRaw) || 0;
  const gutterMm = parseFloat(gutterMmRaw) || 0;
  const labelHeightMm = parseFloat(labelHeightMmRaw) || 0;
  const paddingMm = parseFloat(paddingMmRaw) || 0;

  // Store aspect ratio when dimensions change
  const aspectRatio = artWidthMm > 0 && artHeightMm > 0 ? artWidthMm / artHeightMm : 1;

  // Cell size uses max dimension to ensure all SVGs fit
  const cellSizeMm = Math.max(artWidthMm, artHeightMm) + (paddingMm * 2) + labelHeightMm;

  // Handlers for art dimension changes with aspect lock
  const handleArtWidthChange = (rawValue: string) => {
    setArtWidthMmRaw(rawValue);
    const newWidth = parseFloat(rawValue) || 0;
    if (aspectLocked && newWidth > 0 && aspectRatio > 0) {
      setArtHeightMmRaw(String(Math.round((newWidth / aspectRatio) * 100) / 100));
    }
  };

  const handleArtHeightChange = (rawValue: string) => {
    setArtHeightMmRaw(rawValue);
    const newHeight = parseFloat(rawValue) || 0;
    if (aspectLocked && newHeight > 0 && aspectRatio > 0) {
      setArtWidthMmRaw(String(Math.round((newHeight * aspectRatio) * 100) / 100));
    }
  };
  const [showCellBorders, setShowCellBorders] = useState(true);
  const [removeOrnamentHole, setRemoveOrnamentHole] = useState(false);
  const [addRoundBacker, setAddRoundBacker] = useState(false);
  const [roundBackerStrokeWidthRaw, setRoundBackerStrokeWidthRaw] = useState('0.5');
  const roundBackerStrokeWidth = parseFloat(roundBackerStrokeWidthRaw) || 0.5;
  // null = passthrough mode (show SVG exactly as-is with no modifications)
  const [layerSettings, setLayerSettings] = useState<LayerConfig[] | null>(null);
  const [layerPreset, setLayerPreset] = useState<'original' | 'inverted' | 'custom'>('original');

  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [generatedPanels, setGeneratedPanels] = useState<string[] | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [labelDepthByPath, setLabelDepthByPath] = useState<Record<string, 0 | 1>>({});
  const [labelOverrideByPath, setLabelOverrideByPath] = useState<Record<string, string>>({});
  const [fileNameColWidthPx, setFileNameColWidthPx] = useState(320);
  const [isResizingCol, setIsResizingCol] = useState(false);
  const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [labelSource, setLabelSource] = useState<'parentFolder' | 'fileName'>(() => {
    try {
      const saved = localStorage.getItem('svgPanelGeneratorLabelSource');
      return saved === 'fileName' ? 'fileName' : 'parentFolder';
    } catch {
      return 'parentFolder';
    }
  });

  // Export modal state
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportBaseName, setExportBaseName] = useState('panel');
  const [pendingExportPanels, setPendingExportPanels] = useState<string[] | null>(null);
  const exportInputRef = useRef<HTMLInputElement | null>(null);

  // Preview modal state
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewModalIndex, setPreviewModalIndex] = useState(0);
  // Track generation parameters to avoid regenerating when nothing changed
  const [lastGenerationKey, setLastGenerationKey] = useState<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (isDarkMode) root.classList.add('dark');
    else root.classList.remove('dark');
    try {
      localStorage.setItem('svgPanelGeneratorTheme', isDarkMode ? 'dark' : 'light');
    } catch {
      // ignore
    }
  }, [isDarkMode]);

  useEffect(() => {
    try {
      localStorage.setItem('svgPanelGeneratorLabelSource', labelSource);
    } catch {
      // ignore
    }
  }, [labelSource]);

  const filteredFiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    const files = scan?.files ?? [];
    return files.filter((f) => {
      if (!q) return true;
      return f.name.toLowerCase().includes(q);
    });
  }, [scan, search]);

  const selectedFiles = useMemo(() => {
    const files = scan?.files ?? [];
    const picked = files.filter((f) => selectedPaths.has(f.path));
    picked.sort((a, b) => a.path.localeCompare(b.path));
    return picked;
  }, [scan, selectedPaths]);

  const selectedCount = selectedPaths.size;

  const allFilteredSelected = useMemo(() => {
    if (filteredFiles.length === 0) return false;
    return filteredFiles.every((f) => selectedPaths.has(f.path));
  }, [filteredFiles, selectedPaths]);

  const someFilteredSelected = useMemo(() => {
    if (filteredFiles.length === 0) return false;
    return filteredFiles.some((f) => selectedPaths.has(f.path));
  }, [filteredFiles, selectedPaths]);

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = !allFilteredSelected && someFilteredSelected;
  }, [allFilteredSelected, someFilteredSelected]);

  const grid = useMemo(() => {
    return computeGridLayout({ panelWidthMm, panelHeightMm, cellSizeMm, marginMm: 0, gutterMm });
  }, [panelWidthMm, panelHeightMm, cellSizeMm, gutterMm]);

  const panelCount = useMemo(() => {
    return computePanelCount(selectedFiles.length, grid.capacityPerPanel);
  }, [selectedFiles.length, grid.capacityPerPanel]);

  const layoutWarning = useMemo(() => {
    if (panelWidthMm <= 0 || panelHeightMm <= 0) return 'Panel width/height must be > 0.';
    if (artWidthMm <= 0 || artHeightMm <= 0) return 'Art width/height must be > 0.';
    if (labelHeightMm < 0) return 'Label height must be >= 0.';
    if (paddingMm < 0) return 'Padding must be >= 0.';
    if (grid.capacityPerPanel <= 0) return 'Grid does not fit: increase panel size, reduce margins/gutter, or reduce art size.';
    return null;
  }, [panelWidthMm, panelHeightMm, artWidthMm, artHeightMm, labelHeightMm, paddingMm, grid.capacityPerPanel]);

  /**
   * Process scan result and update state.
   */
  const processScanResult = async (result: ScanResult) => {
    setScan(result);
    setRootFolder(result.root);
    setSelectedPaths(new Set());
    setGeneratedPanels(null);
    setLastGenerationKey(null);
    setLabelDepthByPath({});
    setLabelOverrideByPath({});

    // Auto-size art based on first SVG file (exact dimensions)
    // Measures actual content bounds and converts to mm at 72 DPI (Adobe/xTool standard)
    if (result.files.length > 0 && result.files[0]) {
      const dims = await getSvgFileDimensions(result.files[0].file);
      if (dims && dims.width > 0 && dims.height > 0 && dims.width < 1000 && dims.height < 1000) {
        setArtWidthMmRaw(String(Math.round(dims.width * 100) / 100));
        setArtHeightMmRaw(String(Math.round(dims.height * 100) / 100));
      }
    }
  };

  /**
   * Handle drag events for the drop zone.
   */
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set to false if we're leaving the drop zone, not entering a child element
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    setScanError(null);
    setIsScanning(true);

    try {
      const result = await scanFromDataTransfer(e.dataTransfer);
      if (result.files.length === 0) {
        setScanError('No SVG files found in the dropped items. Try dropping a folder containing SVG files.');
        setIsScanning(false);
        return;
      }
      await processScanResult(result);
    } catch (err) {
      setScan(null);
      setSelectedPaths(new Set());
      setGeneratedPanels(null);
      setLastGenerationKey(null);
      setLabelDepthByPath({});
      setLabelOverrideByPath({});
      setScanError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsScanning(false);
    }
  };

  const toggleSelected = (path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      for (const f of filteredFiles) next.add(f.path);
      return next;
    });
  };

  const deselectAllFiltered = () => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      for (const f of filteredFiles) next.delete(f.path);
      return next;
    });
  };

  const clearSelection = () => setSelectedPaths(new Set());

  const generatePanels = async () => {
    if (!scan?.fileMap) {
      setGenError('No files loaded. Please select a folder first.');
      return;
    }

    // Compute a key from all generation parameters to detect if anything changed
    const currentKey = JSON.stringify({
      files: selectedFilesForOutput.map(f => f.path),
      panelWidthMm, panelHeightMm, cellSizeMm, artWidthMm, artHeightMm,
      gutterMm, labelHeightMm, paddingMm, showCellBorders,
      removeOrnamentHole, addRoundBacker, roundBackerStrokeWidth, layerSettings,
    });

    // If panels are already generated with the same parameters, just show the modal
    if (generatedPanels && lastGenerationKey === currentKey) {
      setShowPreviewModal(true);
      return;
    }

    setGenError(null);
    setIsGenerating(true);
    try {
      const built = await buildPanelSvgs(selectedFilesForOutput, {
        panelWidthMm,
        panelHeightMm,
        cellSizeMm,
        artWidthMm,
        artHeightMm,
        marginMm: 0,
        gutterMm,
        labelHeightMm,
        paddingMm,
        showCellBorders,
        removeOrnamentHole,
        addRoundBacker,
        roundBackerStrokeWidth,
        layerSettings,
      }, scan.fileMap);
      setGeneratedPanels(built.panelSvgs);
      setLastGenerationKey(currentKey);
      setPreviewModalIndex(0);
      setShowPreviewModal(true);
    } catch (e) {
      setGeneratedPanels(null);
      setLastGenerationKey(null);
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsGenerating(false);
    }
  };

  const exportPanels = async () => {
    if (!scan?.fileMap) {
      setGenError('No files loaded. Please select a folder first.');
      return;
    }

    setExportMessage(null);
    setGenError(null);
    setIsExporting(true);
    try {
      // Always rebuild so export matches current selection/settings.
      const built = await buildPanelSvgs(selectedFilesForOutput, {
        panelWidthMm,
        panelHeightMm,
        cellSizeMm,
        artWidthMm,
        artHeightMm,
        marginMm: 0,
        gutterMm,
        labelHeightMm,
        paddingMm,
        showCellBorders,
        removeOrnamentHole,
        addRoundBacker,
        roundBackerStrokeWidth,
        layerSettings,
      }, scan.fileMap);

      if (!built.panelSvgs.length) {
        setExportMessage('Nothing to export (no panels generated).');
        setIsExporting(false);
        return;
      }

      // Show filename modal
      setPendingExportPanels(built.panelSvgs);
      setShowExportModal(true);
      setGeneratedPanels(built.panelSvgs);
      // Focus the input when modal opens
      setTimeout(() => exportInputRef.current?.select(), 100);
    } catch (e) {
      setExportMessage(null);
      setGenError(e instanceof Error ? e.message : String(e));
      setIsExporting(false);
    }
  };

  const confirmExport = async () => {
    if (!pendingExportPanels) return;

    const baseName = exportBaseName.trim() || 'panel';

    try {
      // Download all files
      const fileNames = await downloadPanelSvgs(pendingExportPanels, baseName);
      setExportMessage(`Downloaded ${fileNames.length} panel(s): ${fileNames.join(', ')}`);

      // Close modal and reset
      setShowExportModal(false);
      setPendingExportPanels(null);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsExporting(false);
    }
  };

  const cancelExport = () => {
    setShowExportModal(false);
    setPendingExportPanels(null);
    setIsExporting(false);
    setExportMessage('Export cancelled.');
  };

  const getEffectiveLabelForPath = (filePath: string, fallback: string) => {
    const override = labelOverrideByPath[filePath];
    if (override && override.trim()) return override.trim();
    if (labelSource === 'fileName') {
      return getBasenameNoExt(filePath) || fallback;
    }
    const depth = labelDepthByPath[filePath] ?? 0;
    const label = getNthParentFolderName(filePath, depth);
    return label || fallback;
  };

  const canMoveLabelUp = (filePath: string): boolean => {
    const dir = getParentDir(filePath);
    if (!dir) return false;
    const up = getParentDir(dir);
    return !!up;
  };

  const selectedFilesForOutput = useMemo(() => {
    return selectedFiles.map((f) => ({
      ...f,
      parentFolder: getEffectiveLabelForPath(f.path, f.parentFolder),
    }));
  }, [selectedFiles, labelDepthByPath, labelOverrideByPath, labelSource]);

  // Column resize handlers
  const handleColResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingCol(true);
    resizeStartRef.current = { startX: e.clientX, startWidth: fileNameColWidthPx };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    if (!isResizingCol) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeStartRef.current) return;
      const delta = e.clientX - resizeStartRef.current.startX;
      const newWidth = Math.max(150, Math.min(600, resizeStartRef.current.startWidth + delta));
      setFileNameColWidthPx(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingCol(false);
      resizeStartRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingCol]);

  return (
    <div
      className="min-h-screen bg-[var(--app-bg)] text-[var(--app-fg)]"
      ref={dropZoneRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-indigo-600/90 backdrop-blur-sm">
          <div className="text-center">
            <div className="text-6xl mb-4">📁</div>
            <h2 className="text-2xl font-bold text-white mb-2">Drop folder here</h2>
            <p className="text-indigo-200">Release to scan for SVG files</p>
          </div>
        </div>
      )}

      {/* Use full window width (no max-w cap) so 1920px layouts can actually fit side-by-side. */}
      <div className="mx-auto w-full px-4 py-4 sm:px-6 sm:py-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(420px,1fr)_minmax(300px,380px)] xl:grid-cols-[minmax(520px,1fr)_minmax(320px,420px)]">
          {/* LEFT: Files */}
          <div className="flex min-h-0 flex-col gap-4">
            <section className="rounded-xl border border-slate-300 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-900/40">
              <div className="flex flex-wrap items-center gap-2">
                {/* Drag-and-drop indicator */}
                <div className="flex items-center gap-2 rounded-lg border-2 border-dashed border-indigo-400 bg-indigo-50 px-3 py-2 dark:border-indigo-600 dark:bg-indigo-950/30">
                  <span className="text-lg">📁</span>
                  <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                    {isScanning ? 'Scanning...' : 'Drag & drop folder here'}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search..."
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100"
                  />
                </div>

                <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                  <span className="whitespace-nowrap font-semibold text-slate-700 dark:text-slate-300">LABEL:</span>
                  <div
                    className="inline-flex overflow-hidden rounded-lg border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-950/30"
                    role="group"
                    aria-label="Choose label source"
                  >
                    <button
                      type="button"
                      onClick={() => setLabelSource('parentFolder')}
                      className={`px-2.5 py-1 text-xs font-medium ${
                        labelSource === 'parentFolder'
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-800 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900/60'
                      }`}
                      aria-pressed={labelSource === 'parentFolder'}
                      title="Use folder name(s) as the default printed label"
                    >
                      Parent folder
                    </button>
                    <button
                      type="button"
                      onClick={() => setLabelSource('fileName')}
                      className={`px-2.5 py-1 text-xs font-medium ${
                        labelSource === 'fileName'
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-800 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900/60'
                      }`}
                      aria-pressed={labelSource === 'fileName'}
                      title="Use the SVG file name as the default printed label"
                    >
                      File name
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={clearSelection}
                  className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-200 dark:hover:bg-slate-900/60"
                  disabled={selectedCount === 0}
                >
                  Clear
                </button>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
                <span>
                  <span className="text-slate-600 dark:text-slate-500">Folder:</span>{' '}
                  <span className="font-medium text-slate-900 dark:text-slate-200">
                    {rootFolder ? getBasename(rootFolder) : '(none)'}
                  </span>
                </span>
                <span>
                  <span className="text-slate-600 dark:text-slate-500">Found:</span>{' '}
                  <span className="font-medium text-slate-900 dark:text-slate-200">{scan?.files.length ?? 0}</span>
                </span>
                <span>
                  <span className="text-slate-600 dark:text-slate-500">Showing:</span>{' '}
                  <span className="font-medium text-slate-900 dark:text-slate-200">{filteredFiles.length}</span>
                </span>
                <span>
                  <span className="text-slate-600 dark:text-slate-500">Selected:</span>{' '}
                  <span className="font-medium text-slate-900 dark:text-slate-200">{selectedCount}</span>
                </span>
              </div>

              {scanError && (
                <div className="mt-2 rounded-lg border border-red-900/50 bg-red-950/30 p-2 text-sm text-red-200">
                  {scanError}
                </div>
              )}

              {/* Privacy notice */}
              <div className="mt-2 rounded-lg border border-green-300 bg-green-50 p-2 text-xs text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-200">
                <strong>100% Private:</strong> All processing happens locally in your browser.
                <strong> No files are uploaded anywhere</strong> - your files never leave your computer.
              </div>
            </section>

            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-300 bg-white dark:border-slate-800 dark:bg-slate-950">
              <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
                <label className="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={(e) => {
                      if (e.target.checked) selectAllFiltered();
                      else deselectAllFiltered();
                    }}
                    disabled={filteredFiles.length === 0}
                    className="h-4 w-4 accent-indigo-500"
                  />
                  Select all in search results
                </label>
                <div className="text-xs text-slate-600 dark:text-slate-400">
                  Showing <span className="font-medium text-slate-900 dark:text-slate-200">{filteredFiles.length}</span>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {scan?.files.length ? (
                  <table className="w-full table-fixed border-collapse text-left text-sm">
                    <thead className="sticky top-0 bg-white dark:bg-slate-950">
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-600 dark:border-slate-800 dark:text-slate-400">
                        <th className="w-12 px-3 py-2">Pick</th>
                        <th className="relative px-3 py-2" style={{ width: fileNameColWidthPx }}>
                          File
                          {/* Resize handle */}
                          <div
                            className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-indigo-400 active:bg-indigo-500"
                            onMouseDown={handleColResizeStart}
                            title="Drag to resize column"
                          />
                        </th>
                        <th className="px-3 py-2">Label</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredFiles.map((f) => (
                        <tr
                          key={f.path}
                          className="border-b border-slate-200 hover:bg-slate-100 dark:border-slate-900 dark:hover:bg-slate-900/40"
                        >
                          <td className="px-3 py-2 align-top">
                            <input
                              type="checkbox"
                              checked={selectedPaths.has(f.path)}
                              onChange={() => toggleSelected(f.path)}
                              className="h-4 w-4 accent-indigo-500"
                            />
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="clamp-2 font-medium leading-5 text-slate-900 dark:text-slate-100">
                              {f.name}
                            </div>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="flex items-center justify-between gap-2">
                              <input
                                value={labelOverrideByPath[f.path] ?? getEffectiveLabelForPath(f.path, f.parentFolder)}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setLabelOverrideByPath((prev) => ({ ...prev, [f.path]: v }));
                                }}
                                onBlur={(e) => {
                                  const v = e.target.value.trim();
                                  setLabelOverrideByPath((prev) => {
                                    // If user clears it, remove override so it falls back to computed folder.
                                    if (!v) {
                                      const { [f.path]: _, ...rest } = prev;
                                      return rest;
                                    }
                                    return { ...prev, [f.path]: v };
                                  });
                                }}
                                className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-100"
                                title="Edit the label printed under this SVG"
                                aria-label="Label"
                              />
                              <span className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setLabelDepthByPath((prev) => ({
                                      ...prev,
                                      [f.path]: 1,
                                    }))
                                  }
                                  disabled={
                                    labelSource === 'fileName' ||
                                    !canMoveLabelUp(f.path) ||
                                    (labelDepthByPath[f.path] ?? 0) === 1
                                  }
                                  className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-800 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-200 dark:hover:bg-slate-900/60"
                                  title={
                                    labelSource === 'fileName'
                                      ? 'Label source is File name (folder depth disabled)'
                                      : 'Use a higher parent folder name as the default label'
                                  }
                                  aria-label="Move label up"
                                >
                                  Up
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setLabelDepthByPath((prev) => ({
                                      ...prev,
                                      [f.path]: 0,
                                    }))
                                  }
                                  disabled={labelSource === 'fileName' || (labelDepthByPath[f.path] ?? 0) === 0}
                                  className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-800 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-200 dark:hover:bg-slate-900/60"
                                  title={
                                    labelSource === 'fileName'
                                      ? 'Label source is File name (folder depth disabled)'
                                      : 'Use the immediate parent folder name as the default label'
                                  }
                                  aria-label="Move label down"
                                >
                                  Dn
                                </button>
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-6 text-sm text-slate-600 dark:text-slate-400">
                    Pick a folder to list SVG files. (Nothing scanned yet.)
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* RIGHT: Options + preview */}
          <div className="flex min-w-0 flex-col gap-4">
            <header className="rounded-xl border border-slate-300 bg-white/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                    SVG Panel Generator
                  </h1>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Settings, generation, and preview.</p>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                  <span className="text-slate-600 dark:text-slate-400">Dark mode</span>
                  <input
                    type="checkbox"
                    checked={isDarkMode}
                    onChange={(e) => setIsDarkMode(e.target.checked)}
                    className="h-4 w-4 accent-indigo-500"
                  />
                </label>
              </div>
            </header>

            <section className="rounded-xl border border-slate-300 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-900/40 space-y-4">
              {/* Panel Size */}
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Panel Size</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Total size of your output file (your laser bed)</p>
                <div className="mt-2 flex gap-6">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Width</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={panelWidthMmRaw}
                        onChange={(e) => setPanelWidthMmRaw(e.target.value)}
                        className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-right text-sm tabular-nums text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100"
                      />
                      <span className="text-xs text-slate-500 dark:text-slate-400">mm</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Height</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={panelHeightMmRaw}
                        onChange={(e) => setPanelHeightMmRaw(e.target.value)}
                        className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-right text-sm tabular-nums text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100"
                      />
                      <span className="text-xs text-slate-500 dark:text-slate-400">mm</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Artwork Size */}
              <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Artwork Size</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">How large each design will appear</p>
                <div className="mt-2 flex items-end gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Width</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={artWidthMmRaw}
                        onChange={(e) => handleArtWidthChange(e.target.value)}
                        className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-right text-sm tabular-nums text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100"
                      />
                      <span className="text-xs text-slate-500 dark:text-slate-400">mm</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAspectLocked(!aspectLocked)}
                    className={`mb-1 p-1.5 rounded-md border transition-colors ${
                      aspectLocked
                        ? 'border-indigo-400 bg-indigo-50 text-indigo-600 dark:border-indigo-500 dark:bg-indigo-950/50 dark:text-indigo-400'
                        : 'border-slate-300 bg-white text-slate-400 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-500'
                    }`}
                    title={aspectLocked ? 'Aspect ratio locked - click to unlock' : 'Aspect ratio unlocked - click to lock'}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {aspectLocked ? (
                        <>
                          <path d="M9 17H7A5 5 0 0 1 7 7h2" />
                          <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
                          <line x1="8" y1="12" x2="16" y2="12" />
                        </>
                      ) : (
                        <>
                          <path d="M9 17H7A5 5 0 0 1 7 7h2" />
                          <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
                        </>
                      )}
                    </svg>
                  </button>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Height</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={artHeightMmRaw}
                        onChange={(e) => handleArtHeightChange(e.target.value)}
                        className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-right text-sm tabular-nums text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100"
                      />
                      <span className="text-xs text-slate-500 dark:text-slate-400">mm</span>
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5">Auto-detected from your first SVG file</p>
              </div>

              {/* Spacing */}
              <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Spacing</h3>
                <div className="mt-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm text-slate-700 dark:text-slate-300">Gap between items</span>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">Space between designs horizontally & vertically</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={gutterMmRaw}
                        onChange={(e) => setGutterMmRaw(e.target.value)}
                        className="w-16 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-right text-sm tabular-nums text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100"
                      />
                      <span className="text-xs text-slate-500 dark:text-slate-400">mm</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm text-slate-700 dark:text-slate-300">Label space</span>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">Room below each design for the name</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={labelHeightMmRaw}
                        onChange={(e) => setLabelHeightMmRaw(e.target.value)}
                        className="w-16 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-right text-sm tabular-nums text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100"
                      />
                      <span className="text-xs text-slate-500 dark:text-slate-400">mm</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm text-slate-700 dark:text-slate-300">Padding</span>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">Extra breathing room around each design</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={paddingMmRaw}
                        onChange={(e) => setPaddingMmRaw(e.target.value)}
                        className="w-16 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-right text-sm tabular-nums text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100"
                      />
                      <span className="text-xs text-slate-500 dark:text-slate-400">mm</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Options */}
              <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">Options</h3>
                <div className="space-y-2.5">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showCellBorders}
                      onChange={(e) => setShowCellBorders(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-indigo-500"
                    />
                    <div>
                      <span className="text-sm text-slate-700 dark:text-slate-300">Show cell borders</span>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">Blue outlines around each cell for alignment</p>
                    </div>
                  </label>
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={removeOrnamentHole}
                      onChange={(e) => setRemoveOrnamentHole(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-indigo-500"
                    />
                    <div>
                      <span className="text-sm text-slate-700 dark:text-slate-300">Remove ornament hole</span>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">Strip the hanging hole from ornament designs</p>
                    </div>
                  </label>
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={addRoundBacker}
                      onChange={(e) => setAddRoundBacker(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-indigo-500"
                    />
                    <div>
                      <span className="text-sm text-slate-700 dark:text-slate-300">Add round backer</span>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">Add a circular cut line for magnet backers</p>
                    </div>
                  </label>
                  {addRoundBacker && (
                    <div className="ml-6 flex items-center gap-2">
                      <span className="text-xs text-slate-600 dark:text-slate-400">Stroke width:</span>
                      <input
                        type="number"
                        value={roundBackerStrokeWidthRaw}
                        onChange={(e) => setRoundBackerStrokeWidthRaw(e.target.value)}
                        step={0.1}
                        min={0.1}
                        max={5}
                        className="w-16 rounded-md border border-slate-300 bg-white px-2 py-1 text-right text-sm tabular-nums text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100"
                      />
                      <span className="text-xs text-slate-500 dark:text-slate-400">mm</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Layer Settings */}
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900/50">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Layer Settings</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setLayerSettings(null);
                          setLayerPreset('original');
                        }}
                        className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                          layerPreset === 'original'
                            ? 'bg-indigo-500 text-white'
                            : 'bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
                        }`}
                      >
                        Original
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setLayerSettings([...LAYER_PRESETS.inverted!]);
                          setLayerPreset('inverted');
                        }}
                        className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                          layerPreset === 'inverted'
                            ? 'bg-indigo-500 text-white'
                            : 'bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
                        }`}
                      >
                        Inverted
                      </button>
                    </div>
                  </div>
                  {layerPreset === 'original' ? (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      SVGs will be displayed exactly as they are in the source files, with no color filtering or modifications.
                    </p>
                  ) : (
                  <div className="space-y-1.5">
                    {layerSettings && layerSettings.map((layer, idx) => {
                      const colorNames: Record<string, string> = {
                        '#0000ff': 'Blue (Cut)',
                        '#00c100': 'Green (Engrave)',
                        '#000000': 'Black (Engrave)',
                        '#ff0000': 'Red (Score)',
                      };
                      const isVisible = layer.visibility !== 'hidden';
                      return (
                        <div key={layer.color} className="flex items-center gap-1.5">
                          <div
                            className="h-3 w-3 shrink-0 rounded border border-slate-400"
                            style={{ backgroundColor: layer.color }}
                          />
                          <span className="w-20 shrink-0 text-[10px] text-slate-600 dark:text-slate-400">
                            {colorNames[layer.color] || layer.color}
                          </span>
                          <select
                            value={layer.visibility}
                            onChange={(e) => {
                              const newSettings = [...layerSettings];
                              newSettings[idx] = { ...layer, visibility: e.target.value as LayerConfig['visibility'] };
                              setLayerSettings(newSettings);
                              setLayerPreset('custom');
                            }}
                            className="w-16 shrink-0 rounded border border-slate-300 bg-white px-1 py-0.5 text-[10px] text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                          >
                            <option value="hidden">Hidden</option>
                            <option value="show-color">Show</option>
                          </select>
                          <select
                            value={layer.renderMode}
                            onChange={(e) => {
                              const newSettings = [...layerSettings];
                              newSettings[idx] = { ...layer, renderMode: e.target.value as LayerConfig['renderMode'] };
                              setLayerSettings(newSettings);
                              setLayerPreset('custom');
                            }}
                            disabled={!isVisible}
                            className="w-14 shrink-0 rounded border border-slate-300 bg-white px-1 py-0.5 text-[10px] text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                          >
                            <option value="fill">Fill</option>
                            <option value="stroke">Stroke</option>
                          </select>
                          <input
                            type="color"
                            value={layer.outputColor || '#000000'}
                            onChange={(e) => {
                              const newSettings = [...layerSettings];
                              newSettings[idx] = { ...layer, outputColor: e.target.value };
                              setLayerSettings(newSettings);
                              setLayerPreset('custom');
                            }}
                            disabled={!isVisible}
                            className="h-5 w-5 shrink-0 cursor-pointer rounded border border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                            title="Output color"
                          />
                          <input
                            type="text"
                            value={layer.outputColor || '#000000'}
                            onChange={(e) => {
                              const val = e.target.value;
                              // Only update if it looks like a valid hex color
                              if (/^#[0-9a-fA-F]{0,6}$/.test(val)) {
                                const newSettings = [...layerSettings];
                                newSettings[idx] = { ...layer, outputColor: val };
                                setLayerSettings(newSettings);
                                setLayerPreset('custom');
                              }
                            }}
                            disabled={!isVisible}
                            className="w-16 shrink-0 rounded border border-slate-300 bg-white px-1 py-0.5 text-[10px] text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                            placeholder="#000000"
                          />
                        </div>
                      );
                    })}
                  </div>
                  )}
                </div>

              <div className="mt-2 rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
                <div>
                  Grid: <span className="font-medium">{grid.cols}</span>x<span className="font-medium">{grid.rows}</span> ={' '}
                  <span className="font-medium">{grid.capacityPerPanel}</span> per panel
                </div>
                <div>
                  Selected: <span className="font-medium">{selectedFiles.length}</span> -&gt; Panels:{' '}
                  <span className="font-medium">{panelCount}</span>
                </div>
                {layoutWarning && <div className="mt-2 text-amber-700 dark:text-amber-300">{layoutWarning}</div>}
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={generatePanels}
                  disabled={isGenerating || selectedFiles.length === 0 || grid.capacityPerPanel <= 0}
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-400 disabled:opacity-50"
                >
                  {isGenerating ? 'Generating...' : 'Preview'}
                </button>
                <button
                  type="button"
                  onClick={exportPanels}
                  disabled={isExporting || isGenerating || selectedFiles.length === 0 || grid.capacityPerPanel <= 0}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {isExporting ? 'Exporting...' : 'Download'}
                </button>
              </div>

              {exportMessage && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200">
                  {exportMessage}
                </div>
              )}

              {genError && (
                <div className="mt-3 rounded-lg border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-200">
                  {genError}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      {showPreviewModal && generatedPanels && generatedPanels.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="relative flex h-full max-h-[90vh] w-full max-w-5xl flex-col rounded-xl border border-slate-300 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Preview</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Panel {previewModalIndex + 1} of {generatedPanels.length}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPreviewModal(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                aria-label="Close preview"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Preview Content */}
            <div className="flex-1 overflow-auto p-6">
              <div
                className="mx-auto h-full w-full rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950"
                style={{ aspectRatio: `${panelWidthMm} / ${panelHeightMm}`, maxHeight: '100%' }}
              >
                <div
                  className="h-full w-full"
                  dangerouslySetInnerHTML={{
                    __html: generatedPanels[previewModalIndex]
                      .replace(/width="[^"]*mm?"/, `width="100%"`)
                      .replace(/height="[^"]*mm?"/, `height="100%"`)
                      .replace(/<svg/, `<svg preserveAspectRatio="xMidYMid meet"`),
                  }}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4 dark:border-slate-700">
              {/* Navigation */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewModalIndex((i) => Math.max(0, i - 1))}
                  disabled={previewModalIndex === 0}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewModalIndex((i) => Math.min(generatedPanels.length - 1, i + 1))}
                  disabled={previewModalIndex >= generatedPanels.length - 1}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  Next
                </button>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowPreviewModal(false)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowPreviewModal(false);
                    exportPanels();
                  }}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
                >
                  Download All
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Export Filename Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-xl border border-slate-300 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Download Panels</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Enter a base filename for the downloaded SVG{pendingExportPanels && pendingExportPanels.length > 1 ? 's' : ''}.
              {pendingExportPanels && pendingExportPanels.length > 1 && (
                <span className="block mt-1">
                  Files will be named: <span className="font-mono text-slate-800 dark:text-slate-200">{exportBaseName || 'panel'}_001.svg</span>, <span className="font-mono text-slate-800 dark:text-slate-200">{exportBaseName || 'panel'}_002.svg</span>, etc.
                </span>
              )}
              {pendingExportPanels && pendingExportPanels.length === 1 && (
                <span className="block mt-1">
                  File will be named: <span className="font-mono text-slate-800 dark:text-slate-200">{exportBaseName || 'panel'}.svg</span>
                </span>
              )}
            </p>
            <div className="mt-4">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Filename</label>
              <input
                ref={exportInputRef}
                type="text"
                value={exportBaseName}
                onChange={(e) => setExportBaseName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmExport();
                  if (e.key === 'Escape') cancelExport();
                }}
                placeholder="panel"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={cancelExport}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmExport}
                disabled={!exportBaseName.trim()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                Download
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
