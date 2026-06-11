export interface ForecastRequest {
  latitude: number;
  longitude: number;
  altitude: 10 | 100;
  date: string;
}

export interface WindForecast {
  windDirection: number;
  windSpeed: number;
}

interface OpenMeteoHourly {
  time: string[];
  wind_speed_10m?: number[];
  wind_direction_10m?: number[];
  wind_speed_100m?: number[];
  wind_direction_100m?: number[];
}

export type FetchLike = typeof fetch;

function parseClientDate(value: string): Date {
  const normalized = value.replace(
    /\.(\d{1,3})Z$/,
    (_, digits: string) => `.${digits.padEnd(3, "0")}Z`,
  );
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date");
  return date;
}

function formatHour(date: Date): string {
  return date.toISOString().slice(0, 13) + ":00";
}

export async function fetchForecast(
  baseUrl: string,
  request: ForecastRequest,
  fetchImpl: FetchLike = fetch,
): Promise<WindForecast> {
  const requestedAt = parseClientDate(request.date);
  const start = new Date(requestedAt.getTime() - 60 * 60 * 1000);
  const end = new Date(requestedAt.getTime() + 60 * 60 * 1000);
  const suffix = request.altitude === 10 ? "10m" : "100m";
  const speedKey = `wind_speed_${suffix}` as const;
  const directionKey = `wind_direction_${suffix}` as const;

  const url = new URL(baseUrl);
  url.searchParams.set("latitude", String(request.latitude));
  url.searchParams.set("longitude", String(request.longitude));
  url.searchParams.set("hourly", `${speedKey},${directionKey}`);
  url.searchParams.set("timezone", "GMT");
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("start_hour", formatHour(start));
  url.searchParams.set("end_hour", formatHour(end));

  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`);
  const data = (await response.json()) as { hourly?: OpenMeteoHourly };
  const hourly = data.hourly;
  const speeds = hourly?.[speedKey];
  const directions = hourly?.[directionKey];
  if (!hourly || !speeds || !directions || hourly.time.length === 0) {
    throw new Error("Open-Meteo response is incomplete");
  }

  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  hourly.time.forEach((time, index) => {
    const distance = Math.abs(
      new Date(`${time}:00Z`).getTime() - requestedAt.getTime(),
    );
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  const windSpeed = speeds[nearestIndex];
  const windDirection = directions[nearestIndex];
  if (!Number.isFinite(windSpeed) || !Number.isFinite(windDirection)) {
    throw new Error("Open-Meteo response is incomplete");
  }
  return { windDirection, windSpeed };
}
