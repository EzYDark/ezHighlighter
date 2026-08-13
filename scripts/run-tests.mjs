import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "ez-highlighter-tests-"));

try {
    const obsidianStub = join(temporaryDirectory, "obsidian-stub.mjs");
    await writeFile(
        obsidianStub,
        [
            "// The edit-guard tests do not construct an EditorView.",
            "export const editorInfoField = {};",
            "export const editorLivePreviewField = {};",
        ].join("\n"),
        "utf8",
    );

    const resultFiles = [];

    for (const testFile of [
        "tests/syntax.test.ts",
        "tests/edit-guard.test.ts",
    ]) {
        const outputFile = join(
            temporaryDirectory,
            testFile.replaceAll(/[\\/]/g, "-").replace(/\.ts$/, ".mjs"),
        );

        await build({
            entryPoints: [testFile],
            bundle: true,
            platform: "node",
            format: "esm",
            target: "node18",
            outfile: outputFile,
            plugins: [{
                name: "obsidian-test-stub",
                setup(buildContext) {
                    buildContext.onResolve(
                        { filter: /^obsidian$/ },
                        () => ({ path: obsidianStub }),
                    );
                },
            }],
        });

        resultFiles.push(outputFile);
    }

    const result = spawnSync(
        process.execPath,
        ["--test", ...resultFiles],
        { stdio: "inherit" },
    );

    if (result.error) {
        throw result.error;
    }

    process.exitCode = result.status ?? 1;
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}
