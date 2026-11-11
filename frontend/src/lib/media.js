// Adding picked files to a dive: photos are downscaled, videos become clips.

import { addPhoto, addClip } from "./app.svelte.js";
import { preparePhoto } from "./image.js";
import { isClipFile, prepareClip } from "./clip.js";

/** What the photo pickers accept. */
export const MEDIA_ACCEPT = "image/*,video/*";

/**
 * Add photos and clips to a dive, in the order picked. onStatus(text) reports
 * clip conversion ("Preparing clip 40%"). Returns { added, notes }, where notes
 * are things worth telling the user (e.g. a clip lost its sound).
 */
export async function addMedia(diveId, files, { onStatus } = {}) {
  const added = [];
  const notes = [];
  const clips = files.filter(isClipFile).length;
  let n = 0;
  for (const f of files) {
    if (isClipFile(f)) {
      n++;
      const which = clips > 1 ? ` ${n} of ${clips}` : "";
      onStatus?.(`Preparing clip${which}…`);
      const clip = await prepareClip(f, { onProgress: (p) => onStatus?.(`Preparing clip${which} ${Math.round(p * 100)}%`) });
      if (clip.soundDropped) notes.push(`${f.name}: this browser can't convert its sound, so the clip was added without it.`);
      added.push(await addClip(diveId, clip));
    } else {
      onStatus?.("Adding…");
      added.push(await addPhoto(diveId, await preparePhoto(f)));
    }
  }
  onStatus?.("");
  return { added, notes };
}
