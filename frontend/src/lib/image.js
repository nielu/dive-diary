// Downscale an image in the browser before storing it.
// Drawing through a canvas also re-encodes the file, which drops all EXIF
// metadata, including GPS coordinates of cave entrances.

const MAX_PIXELS = 16_000_000; // stay under iOS Safari's canvas limit

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Couldn't read ${file.name || "that image"}. Use a JPEG or PNG.`));
    };
    img.src = url; // modern browsers apply EXIF orientation when decoding
  });
}

export async function prepareImage(file, { maxDim = 2560, quality = 0.85 } = {}) {
  const { img, url } = await loadImage(file);
  try {
    let scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const area = img.naturalWidth * img.naturalHeight * scale * scale;
    if (area > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / area);
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // flatten transparent PNG scans onto white
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't encode the image."))), "image/jpeg", quality),
    );
    const base = (file.name || "image").replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_").slice(0, 40) || "image";
    return { blob, width, height, fileName: `${base}.jpg` };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const prepareMap = (file) => prepareImage(file, { maxDim: 4000, quality: 0.9 });
export const preparePhoto = (file) => prepareImage(file, { maxDim: 2560, quality: 0.85 });
