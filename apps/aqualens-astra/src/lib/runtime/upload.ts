import type { UploadSelection } from "./types";
export async function inspectUpload(file: File): Promise<UploadSelection> {
  if (!/\.(png|jpe?g|pbm|zip)$/i.test(file.name))
    throw new Error("Choose a PNG, JPEG, PBM, or ZIP survey.");
  if (file.size === 0)
    throw new Error(
      "This file is empty. Choose a sonar raster or survey bundle.",
    );
  const out: UploadSelection = {
    file,
    rasterCount: null,
    navigation: null,
    mission: null,
    entries: null,
    preview: null,
  };
  if (/\.zip$/i.test(file.name)) {
    // Central directory only: bounded tail/header reads, no decompression or archive execution.
    const tail = new DataView(
      await file.slice(Math.max(0, file.size - 65557)).arrayBuffer(),
    );
    let end = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--)
      if (tail.getUint32(i, true) === 0x06054b50) {
        end = i;
        break;
      }
    if (end < 0)
      throw new Error(
        "The ZIP directory could not be read. Select a standard, complete ZIP bundle.",
      );
    const count = tail.getUint16(end + 10, true),
      size = tail.getUint32(end + 12, true),
      start = tail.getUint32(end + 16, true);
    if (count === 65535 || size > 16 * 1024 * 1024 || start + size > file.size)
      throw new Error(
        "This ZIP directory is too large or uses ZIP64. Use a standard ZIP bundle.",
      );
    const buffer = await file.slice(start, start + size).arrayBuffer();
    const view = new DataView(buffer);
    let at = 0;
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      if (
        at + 46 > buffer.byteLength ||
        view.getUint32(at, true) !== 0x02014b50
      )
        throw new Error("This ZIP has an incomplete directory.");
      const n = view.getUint16(at + 28, true),
        extra = view.getUint16(at + 30, true),
        comment = view.getUint16(at + 32, true);
      if (at + 46 + n + extra + comment > buffer.byteLength)
        throw new Error("This ZIP has an invalid entry.");
      names.push(new TextDecoder().decode(new Uint8Array(buffer, at + 46, n)));
      at += 46 + n + extra + comment;
    }
    out.entries = names.filter(
      (n) => !n.endsWith("/") && !n.startsWith("__MACOSX/"),
    );
    out.rasterCount = out.entries.filter((n) =>
      /\.(png|jpe?g|pbm)$/i.test(n),
    ).length;
    out.navigation = names.some((n) => /(^|\/)navigation\.csv$/i.test(n));
    out.mission = names.some((n) => /(^|\/)mission\.json$/i.test(n));
    if (!out.rasterCount)
      throw new Error("No supported sonar rasters were found in this ZIP.");
  } else {
    out.rasterCount = 1;
    out.navigation = false;
    out.mission = false;
    if (/\.(png|jpe?g)$/i.test(file.name)) {
      const bitmap = await createImageBitmap(file).catch(() => null);
      if (!bitmap)
        throw new Error("This image cannot be decoded. Choose a valid raster.");
      bitmap.close();
      out.preview = URL.createObjectURL(file);
    }
  }
  return out;
}
