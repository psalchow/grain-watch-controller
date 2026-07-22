export interface Point {
  measurement: string;
  tags: Record<string, string>;
  fields: Record<string, number>;
  tsSeconds: number;
}

/** Builds InfluxDB line protocol (second precision). Field names may contain hyphens. */
export function toLineProtocol(points: Point[]): string {
  return points
    .map((p) => {
      const tags = Object.entries(p.tags).map(([k, v]) => `${k}=${v}`).join(',');
      const fields = Object.entries(p.fields).map(([k, v]) => `${k}=${v}`).join(',');
      const measurementAndTags = tags ? `${p.measurement},${tags}` : p.measurement;
      return `${measurementAndTags} ${fields} ${p.tsSeconds}`;
    })
    .join('\n');
}
