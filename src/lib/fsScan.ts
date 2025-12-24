import { getBasename, getParentFolderName } from './pathUtils';

export interface ScannedSvgFile {
  path: string;           // webkitRelativePath from browser
  name: string;           // filename
  parentFolder: string;   // immediate parent folder name
  file: File;             // Store File object for later reading
}

export interface ScanResult {
  root: string;
  files: ScannedSvgFile[];
  fileMap: Map<string, File>;  // Map path -> File for reading contents
}

function isSvgFileName(name: string): boolean {
  return name.toLowerCase().endsWith('.svg');
}

/**
 * Check if the browser supports the File System Access API.
 * This API provides a cleaner folder picker without scary "upload" wording.
 * Supported in Chrome/Edge, NOT supported in Firefox/Safari.
 */
export function supportsFileSystemAccess(): boolean {
  return 'showDirectoryPicker' in window;
}

// Extend the FileSystemDirectoryHandle type to include the values() method
// TypeScript's lib doesn't include the full File System Access API
interface ExtendedFileSystemDirectoryHandle extends FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemHandle>;
}

/**
 * Scan a directory using the File System Access API.
 * This provides a cleaner UX without the scary "upload files" dialog.
 *
 * Only works in Chrome and Edge (not Firefox or Safari).
 * All processing happens client-side - no files are uploaded anywhere.
 */
export async function scanFromDirectoryHandle(
  dirHandle: FileSystemDirectoryHandle
): Promise<ScanResult> {
  const files: ScannedSvgFile[] = [];
  const fileMap = new Map<string, File>();
  const rootFolder = dirHandle.name;

  // Recursively scan the directory
  async function scanDir(handle: FileSystemDirectoryHandle, pathPrefix: string) {
    // Cast to extended type that includes values() method
    const extHandle = handle as ExtendedFileSystemDirectoryHandle;
    for await (const entry of extHandle.values()) {
      if (entry.kind === 'file') {
        const fileHandle = entry as FileSystemFileHandle;
        if (isSvgFileName(fileHandle.name)) {
          const file = await fileHandle.getFile();
          const relativePath = pathPrefix ? `${pathPrefix}/${fileHandle.name}` : fileHandle.name;
          files.push({
            path: relativePath,
            name: getBasename(relativePath),
            parentFolder: getParentFolderName(relativePath) || rootFolder,
            file: file,
          });
          fileMap.set(relativePath, file);
        }
      } else if (entry.kind === 'directory') {
        const subDirHandle = entry as FileSystemDirectoryHandle;
        const newPath = pathPrefix ? `${pathPrefix}/${subDirHandle.name}` : subDirHandle.name;
        await scanDir(subDirHandle, newPath);
      }
    }
  }

  await scanDir(dirHandle, '');

  // Deterministic ordering
  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    root: rootFolder,
    files,
    fileMap,
  };
}

/**
 * Scan files from a DataTransfer object (from drag-and-drop).
 * Works in all browsers without the scary "upload" dialog.
 *
 * All processing happens client-side - no files are uploaded anywhere.
 */
export async function scanFromDataTransfer(dataTransfer: DataTransfer): Promise<ScanResult> {
  const files: ScannedSvgFile[] = [];
  const fileMap = new Map<string, File>();
  let rootFolder = 'Dropped Files';

  // Try to use webkitGetAsEntry for directory support (Chrome, Edge, Firefox)
  const items = dataTransfer.items;
  const entries: FileSystemEntry[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'file') {
      const entry = item.webkitGetAsEntry?.();
      if (entry) {
        entries.push(entry);
      }
    }
  }

  if (entries.length > 0) {
    // We have file system entries - use them for better directory support
    async function scanEntry(entry: FileSystemEntry, pathPrefix: string) {
      if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry;
        return new Promise<void>((resolve) => {
          fileEntry.file((file) => {
            if (isSvgFileName(file.name)) {
              const relativePath = pathPrefix ? `${pathPrefix}/${file.name}` : file.name;
              files.push({
                path: relativePath,
                name: getBasename(relativePath),
                parentFolder: getParentFolderName(relativePath) || rootFolder,
                file: file,
              });
              fileMap.set(relativePath, file);
            }
            resolve();
          }, () => resolve()); // Ignore errors
        });
      } else if (entry.isDirectory) {
        const dirEntry = entry as FileSystemDirectoryEntry;
        const reader = dirEntry.createReader();

        return new Promise<void>((resolve) => {
          const readEntries = () => {
            reader.readEntries(async (results) => {
              if (results.length === 0) {
                resolve();
              } else {
                const newPath = pathPrefix ? `${pathPrefix}/${dirEntry.name}` : dirEntry.name;
                for (const result of results) {
                  await scanEntry(result, newPath);
                }
                // Keep reading until no more entries
                readEntries();
              }
            }, () => resolve()); // Ignore errors
          };
          readEntries();
        });
      }
    }

    // Get root folder name from first directory entry
    for (const entry of entries) {
      if (entry.isDirectory) {
        rootFolder = entry.name;
        break;
      }
    }

    // Scan all entries
    for (const entry of entries) {
      await scanEntry(entry, '');
    }
  } else {
    // Fallback: just use the files directly (no directory structure)
    const fileList = dataTransfer.files;
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (file && isSvgFileName(file.name)) {
        files.push({
          path: file.name,
          name: file.name,
          parentFolder: rootFolder,
          file: file,
        });
        fileMap.set(file.name, file);
      }
    }
  }

  // Deterministic ordering
  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    root: rootFolder,
    files,
    fileMap,
  };
}

/**
 * Scan a FileList (from <input type="file" webkitdirectory>) for SVG files.
 * This is the browser equivalent of the Tauri scanForSvgFiles function.
 *
 * All processing happens client-side - no files are uploaded anywhere.
 */
export function scanFilesFromFileList(fileList: FileList): ScanResult {
  const files: ScannedSvgFile[] = [];
  const fileMap = new Map<string, File>();
  let rootFolder = '';

  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    if (!file) continue;

    // webkitRelativePath gives us the path relative to selected folder
    // e.g., "MyFolder/subfolder/file.svg"
    const relativePath = file.webkitRelativePath || file.name;

    // Extract root folder name from first file
    if (!rootFolder && relativePath.includes('/')) {
      rootFolder = relativePath.split('/')[0] || '';
    }

    if (isSvgFileName(file.name)) {
      files.push({
        path: relativePath,
        name: getBasename(relativePath),
        parentFolder: getParentFolderName(relativePath),
        file: file,
      });
      fileMap.set(relativePath, file);
    }
  }

  // Deterministic ordering
  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    root: rootFolder || 'Selected Files',
    files,
    fileMap,
  };
}

/**
 * Read a file's text content from the fileMap.
 * This replaces Tauri's readTextFile.
 */
export async function readFileFromMap(fileMap: Map<string, File>, path: string): Promise<string> {
  const file = fileMap.get(path);
  if (!file) {
    throw new Error(`File not found: ${path}`);
  }
  return await file.text();
}
