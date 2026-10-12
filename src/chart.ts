export function chartRange(points: number[][]): [number, number] {
  const values = points.map((p) => p[1]).filter(Number.isFinite);
  const min = Math.min(...values), max = Math.max(...values);
  if (!values.length) return [0, 1];
  const pad = (max - min || Math.abs(max) * .01 || 1) * .08;
  return [min - pad, max + pad];
}
export function nearestPoint(points: number[][], time: number) {
  return points.reduce((best, p, i) => Math.abs(p[0] - time) < Math.abs(points[best][0] - time) ? i : best, 0);
}
