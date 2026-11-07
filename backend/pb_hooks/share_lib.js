// Shared helpers for the share routes. Hook handlers run in isolated
// contexts, so they load this with require(`${__hooks}/share_lib.js`).

/** The active share for a token, or a 404 if it's unknown, off or expired. */
function findShare(app, token) {
  if (!/^[A-Za-z0-9]{24,64}$/.test(token || "")) {
    throw new NotFoundError("This link doesn't exist.");
  }
  let share;
  try {
    share = app.findFirstRecordByData("shares", "token", token);
  } catch (_) {
    throw new NotFoundError("This link doesn't exist or was turned off.");
  }
  const expires = share.getString("expires");
  if (expires && new Date(expires.replace(" ", "T")) < new Date()) {
    throw new NotFoundError("This link has expired.");
  }
  return share;
}

/** Whether a dive belongs to what the share covers. */
function shareCoversDive(share, dive) {
  const trip = share.getString("trip");
  return !trip || dive.getString("trip") === trip;
}

// Thumbnail sizes the app asks for (must match the fields' thumbs).
const THUMBS = { maps: ["480x0"], photos: ["480x480f"] };

module.exports = { findShare, shareCoversDive, THUMBS };
