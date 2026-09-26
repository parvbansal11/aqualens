export interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

export function fillHeightTransform(
  viewportHeight: number,
  imageHeight: number,
): ViewTransform {
  const scale = viewportHeight / imageHeight;
  return { scale, x: 0, y: 0 };
}

export function fitTransform(
  viewportWidth: number,
  viewportHeight: number,
  imageWidth: number,
  imageHeight: number,
): ViewTransform {
  const scale = Math.min(
    viewportWidth / imageWidth,
    viewportHeight / imageHeight,
  );
  return {
    scale,
    x: (viewportWidth - imageWidth * scale) / 2,
    y: (viewportHeight - imageHeight * scale) / 2,
  };
}

export function bboxToViewport(
  bbox: [number, number, number, number],
  transform: ViewTransform,
): [number, number, number, number] {
  const [x, y, width, height] = bbox;
  return [
    transform.x + x * transform.scale,
    transform.y + y * transform.scale,
    width * transform.scale,
    height * transform.scale,
  ];
}

export function zoomAtPoint(
  transform: ViewTransform,
  point: { x: number; y: number },
  factor: number,
  minScale: number,
  maxScale: number,
): ViewTransform {
  const nextScale = Math.max(
    minScale,
    Math.min(maxScale, transform.scale * factor),
  );
  const imageX = (point.x - transform.x) / transform.scale;
  const imageY = (point.y - transform.y) / transform.scale;
  return {
    scale: nextScale,
    x: point.x - imageX * nextScale,
    y: point.y - imageY * nextScale,
  };
}
