// Утилиты времени: контракты шины — epoch millis (Long)
export function toMillis(d: Date | null | undefined): number | null {
  return d ? d.getTime() : null
}

export function isoOrNull(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}

export function haversineM(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6371000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}
