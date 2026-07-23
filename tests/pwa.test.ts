import assert from "node:assert/strict";
import test from "node:test";
import { readFile, stat } from "node:fs/promises";
import manifest from "../app/manifest";

test("PWA-манифест позволяет установить приложение", () => {
  const value = manifest();
  assert.equal(value.display, "standalone");
  assert.equal(value.start_url, "/");
  assert.equal(value.scope, "/");
  assert.ok(value.icons?.some((icon) => icon.sizes === "192x192"));
  assert.ok(value.icons?.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable"));
});

test("service worker не кэширует API с клиентскими данными", async () => {
  const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(source, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(source, /\/offline\.html/);
  assert.doesNotMatch(source, /cache\.put\(request[\s\S]*\/api\//);
});

test("иконки PWA созданы в обязательных размерах", async () => {
  for (const file of ["icon-192.png", "icon-512.png", "maskable-512.png", "apple-touch-icon.png"]) {
    assert.ok((await stat(new URL(`../public/icons/${file}`, import.meta.url))).size > 1000);
  }
});
