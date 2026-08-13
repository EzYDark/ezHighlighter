import esbuild from "esbuild";
import {
    copyFile,
    mkdir,
    rm,
} from "node:fs/promises";
import process from "process";

const mode = process.argv[2] ?? "development";
const production = mode === "production" || mode === "export";
const exportDirectory = "export/ez-highlighter";
const outfile = `${exportDirectory}/main.js`;

await rm(exportDirectory, { recursive: true, force: true });
await mkdir(exportDirectory, { recursive: true });

const copyPluginFiles = {
    name: "copy-plugin-files",
    setup(build) {
        build.onEnd(async (result) => {
            if (result.errors.length > 0) {
                return;
            }

            await Promise.all([
                copyFile("manifest.json", `${exportDirectory}/manifest.json`),
                copyFile("styles.css", `${exportDirectory}/styles.css`),
            ]);

            console.log(`Built plugin files in ${exportDirectory}`);
        });
    },
};

const context = await esbuild.context({
    entryPoints: ["src/main.ts"],
    bundle: true,
    external: [
        "obsidian",
        "@codemirror/state",
        "@codemirror/view",
    ],
    format: "cjs",
    target: "es2021",
    logLevel: "info",
    sourcemap: production ? false : "inline",
    treeShaking: true,
    outfile,
    minify: production,
    plugins: [copyPluginFiles],
});

if (production) {
    await context.rebuild();
    await context.dispose();
} else {
    await context.watch();
}
