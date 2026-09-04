import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const destination = join(root, "dist", "client");

const files = [
    ".nojekyll",
    ".well-known",
    "IconRounded.png",
    "assets",
    "cursor.js",
    "download.svg",
    "favicon-16.png",
    "favicon-180.png",
    "favicon-32.png",
    "index.html",
    "og.png",
    "phone-mockup.png",
    "privacy",
    "search.js",
    "style.css",
    "terms"
];

await rm(join(root, "dist"), { recursive: true, force: true });
await mkdir(destination, { recursive: true });

for (const file of files) {
    await cp(join(root, file), join(destination, file), {
        recursive: true,
        filter: (source) => !source.endsWith(".DS_Store")
    });
}
