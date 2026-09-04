import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ignoredDirectories = new Set([".git", ".wrangler", "dist", "node_modules"]);
const ignoredExtensions = new Set([".gif", ".ico", ".jpeg", ".jpg", ".mov", ".png", ".webp", ".zip"]);
const findings = [];

const rules = [
    ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
    ["AWS access key", /AKIA[0-9A-Z]{16}/g],
    ["Google API key", /AIza[0-9A-Za-z_-]{35}/g],
    ["GitHub token", /gh[pousr]_[0-9A-Za-z]{20,}/g],
    ["Slack token", /xox[baprs]-[0-9A-Za-z-]{10,}/g],
    ["Stripe secret", /sk_(?:live|test)_[0-9A-Za-z]{10,}/g],
    ["JWT", /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g],
    [
        "hard-coded credential",
        /(?:api[_-]?key|client[_-]?secret|access[_-]?token|password)\s*[:=]\s*["'][A-Za-z0-9_./+=-]{16,}["']/gi
    ]
];

const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name === ".DS_Store") continue;
        if (/^(?:\.dev\.vars|\.env)(?:\.|$)/.test(entry.name) && !entry.name.endsWith(".example")) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            if (!ignoredDirectories.has(entry.name)) await walk(path);
            continue;
        }
        if (!entry.isFile() || ignoredExtensions.has(extname(entry.name).toLowerCase())) continue;

        const content = await readFile(path, "utf8");
        for (const [label, pattern] of rules) {
            pattern.lastIndex = 0;
            for (const match of content.matchAll(pattern)) {
                const line = content.slice(0, match.index).split("\n").length;
                findings.push(`${relative(root, path)}:${line}: ${label}`);
            }
        }
    }
};

await walk(root);

if (findings.length) {
    console.error("Potential secrets detected:\n" + findings.join("\n"));
    process.exitCode = 1;
} else {
    console.log("No potential secrets detected in deployable source files.");
}
