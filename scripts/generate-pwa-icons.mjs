import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const output = new URL("../public/icons/", import.meta.url);
await mkdir(output, { recursive: true });

function iconSvg(maskable = false) {
  const corner = maskable ? 0 : 190;
  return Buffer.from(`
    <svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      <rect width="1024" height="1024" rx="${corner}" fill="#283328"/>
      <rect x="242" y="220" width="540" height="604" rx="66" fill="#f4f5f7"/>
      <path d="M306 370h412M306 505h412M306 640h412" stroke="#7f927b" stroke-width="38" stroke-linecap="round"/>
      <rect x="306" y="286" width="412" height="472" rx="28" fill="none" stroke="#283328" stroke-width="34"/>
      <circle cx="654" cy="697" r="28" fill="#c58a2e"/>
      <path d="M350 220v-54h324v54" fill="none" stroke="#f4f5f7" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `);
}

await sharp(iconSvg()).resize(192, 192).png().toFile(fileURLToPath(new URL("icon-192.png", output)));
await sharp(iconSvg()).resize(512, 512).png().toFile(fileURLToPath(new URL("icon-512.png", output)));
await sharp(iconSvg(true)).resize(512, 512).png().toFile(fileURLToPath(new URL("maskable-512.png", output)));
await sharp(iconSvg()).resize(180, 180).png().toFile(fileURLToPath(new URL("apple-touch-icon.png", output)));
