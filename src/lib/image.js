// Turns a picked picture into a small square JPEG (browser only).
export const AVATAR_SIZE = 320;
const MAX_INPUT_BYTES = 12 * 1024 * 1024;

/** Largest centred square of the picture, scaled to `size` pixels, as a JPEG blob. */
export async function squareJpeg(file, size = AVATAR_SIZE) {
  if (!file || !/^image\/(jpeg|png|webp|gif)$/i.test(file.type)) {
    throw new Error('Choose a JPEG, PNG or WebP picture.');
  }
  if (file.size > MAX_INPUT_BYTES) throw new Error('Choose a picture smaller than 12 MB.');

  let source;
  let width;
  let height;
  let release = () => {};
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
    width = source.width;
    height = source.height;
    release = () => source.close?.();
  } catch {
    // Older browsers: decode through an <img> element.
    const url = URL.createObjectURL(file);
    try {
      source = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('That picture could not be read.'));
        img.src = url;
      });
      width = source.naturalWidth;
      height = source.naturalHeight;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const side = Math.min(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0D1930'; // behind transparent PNGs
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, size, size);
  release();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  if (!blob) throw new Error('That picture could not be processed.');
  return blob;
}
