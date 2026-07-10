import type {
  Alarm,
  CalendarEvent,
  RepeatingTask,
  SportsEvent,
  WeatherSnapshot,
} from "../domain/types";

export const previewWeather: WeatherSnapshot = {
  observedAt: "2026-05-11T19:43:00.000Z",
  weatherCode: 2,
  temperatureC: 21,
  apparentTemperatureC: 21,
  windSpeedKph: 8,
  humidityPercent: 64,
  highC: 23,
  lowC: 14,
  sunrise: "2026-05-11T05:54:00.000Z",
  sunset: "2026-05-11T20:08:00.000Z",
  isDay: false,
};

export const previewTasks: RepeatingTask[] = [
  {
    id: "explore",
    title: "Finish UI explorations",
    enabled: true,
    daysOfWeek: [],
    requiredForCelebration: true,
    preferredTime: "09:30",
    sortOrder: 0,
  },
  {
    id: "email",
    title: "Reply to client emails",
    enabled: true,
    daysOfWeek: [],
    requiredForCelebration: true,
    preferredTime: "12:15",
    sortOrder: 1,
  },
  {
    id: "presentation",
    title: "Refine presentation",
    enabled: true,
    daysOfWeek: [],
    requiredForCelebration: true,
    preferredTime: "16:00",
    sortOrder: 2,
  },
  {
    id: "workout",
    title: "Workout",
    enabled: true,
    daysOfWeek: [],
    requiredForCelebration: true,
    preferredTime: "18:30",
    sortOrder: 3,
  },
];

export const previewEvents: CalendarEvent[] = [
  {
    id: "design-review",
    title: "Design Review",
    startsAt: "2026-05-12T10:00:00",
    endsAt: "2026-05-12T11:00:00",
    allDay: false,
    source: "local",
  },
];

export const previewSports: SportsEvent[] = [
  {
    id: "lal-gsw",
    sport: "Basketball",
    league: "NBA",
    startTime: "2026-05-11T19:20:00",
    awayName: "Lakers",
    homeName: "Warriors",
    awayScore: 112,
    homeScore: 108,
    status: "live",
    clockOrPeriod: "Q4 · 02:34",
  },
  {
    id: "rma-fcb",
    sport: "Football",
    league: "Soccer",
    startTime: "2026-05-11T17:00:00",
    awayName: "Real Madrid",
    homeName: "Barcelona",
    awayScore: 2,
    homeScore: 1,
    status: "final",
    clockOrPeriod: "FT",
  },
];

export const previewAlarm: Alarm = {
  id: "morning-run",
  label: "Morning run",
  localTime: "06:30",
  daysOfWeek: [],
  enabled: true,
  soundId: "ambient-bell",
  snoozeMinutes: 10,
};
