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
  gas: 200,
};

/** Thumbnail sizes the server makes (see the image fields' thumbs). */
export const THUMBS = {
  mapPreview: "1200x1200f", // dive page cards; first image in the map viewer and tour
  photo: "480x480f",
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
  gas: "Gas",
  dive_no: "Dive number",
  computer: "Dive computer",
  source: "Imported from",
  profile: "Depth profile",
};
