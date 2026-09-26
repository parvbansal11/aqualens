/* Reads a ZIP's central directory to list entry basenames -- no decompression,
 * no dependency. Used only so the upload screen can show which companion
 * files (navigation.csv, mission.json) a bundle carries before any network
 * call is made. The backend (packages/sagar/api/app.py) remains the sole
 * authority on whether that metadata actually parses and validates. */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const EOCD_RECORD_SIZE = 22;
const MAX_COMMENT_LENGTH = 65535;

function findEndOfCentralDirectory(view: DataView): number {
  const searchFloor = Math.max(0, view.byteLength - EOCD_RECORD_SIZE - MAX_COMMENT_LENGTH);
  for (let offset = view.byteLength - EOCD_RECORD_SIZE; offset >= searchFloor; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

/** FileReader rather than File.prototype.arrayBuffer(): the older API, more
 * broadly supported across runtimes this page may run in. */
function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/** Basenames of every entry in the ZIP, lower-cased. Empty set for anything
 * that isn't a readable ZIP central directory (never throws). */
export async function zipEntryBasenames(file: File): Promise<Set<string>> {
  try {
    const buffer = await readAsArrayBuffer(file);
    const view = new DataView(buffer);
    const eocdOffset = findEndOfCentralDirectory(view);
    if (eocdOffset === -1) return new Set();

    const entryCount = view.getUint16(eocdOffset + 10, true);
    let cursor = view.getUint32(eocdOffset + 16, true);
    const decoder = new TextDecoder("utf-8");
    const names = new Set<string>();

    for (let i = 0; i < entryCount; i += 1) {
      if (cursor + 46 > buffer.byteLength || view.getUint32(cursor, true) !== CENTRAL_DIR_SIGNATURE) break;
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const nameStart = cursor + 46;
      const name = decoder.decode(new Uint8Array(buffer, nameStart, nameLength));
      const basename = name.split("/").pop() || name;
      names.add(basename.toLowerCase());
      cursor = nameStart + nameLength + extraLength + commentLength;
    }
    return names;
  } catch {
    return new Set();
  }
}
