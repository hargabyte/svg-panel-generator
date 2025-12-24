export function getPathSeparator(path: string): string {
  // Best-effort heuristic: if it contains a backslash, treat as Windows.
  return path.includes('\\') ? '\\' : '/';
}

export function joinPath(parent: string, child: string): string {
  const sep = getPathSeparator(parent);
  const normalizedParent = parent.endsWith(sep) ? parent.slice(0, -1) : parent;
  return `${normalizedParent}${sep}${child}`;
}

export function getBasename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

export function stripExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  if (idx <= 0) return fileName;
  return fileName.slice(0, idx);
}

export function getBasenameNoExt(path: string): string {
  return stripExtension(getBasename(path));
}

export function getParentDir(path: string): string | null {
  const sep = getPathSeparator(path);
  const idx = path.lastIndexOf(sep);
  if (idx <= 0) return null;
  return path.slice(0, idx);
}

export function getParentFolderName(path: string): string {
  const parent = getParentDir(path);
  if (!parent) return '';
  return getBasename(parent);
}

/**
 * Get the folder name N levels above a file path.
 * levelsUp=0 -> immediate parent folder name
 * levelsUp=1 -> parent of parent folder name, etc.
 */
export function getNthParentFolderName(filePath: string, levelsUp: number): string {
  let dir = getParentDir(filePath);
  if (!dir) return '';

  for (let i = 0; i < levelsUp; i++) {
    const up = getParentDir(dir);
    if (!up) return '';
    dir = up;
  }

  return getBasename(dir);
}
