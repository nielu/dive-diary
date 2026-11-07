// Limits that mirror the server schema (backend/pb_migrations), so the editor
// can stop values the server would reject instead of failing at sync time.
export const LIMITS = {
  trip: 120,
  site: 200,
  team: 500,
  leader: 200,
  navigation: 20000,
  log: 50000,
  mapCaption: 200,
  photoCaption: 500,
  shareLabel: 200,
};

/** Human names for server field names, used in sync error messages. */
export const FIELD_LABELS = {
  date: "Date",
  time: "Time in",
  trip: "Trip",
  site: "Site",
  team: "Team",
  leader: "Led by",
  max_depth: "Max depth",
  avg_depth: "Avg depth",
  temp: "Water temp",
  duration: "Run time",
  navigation: "Navigation",
  log: "Log",
  dive: "Dive",
  image: "Image",
  caption: "Caption",
  sort: "Order",
  width: "Width",
  height: "Height",
  markers: "Markers",
  route: "Route",
};
