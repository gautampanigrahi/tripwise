import { defineConfig } from "vitest/config";

// `npx vitest --run` from the repo root runs every workspace's tests (Req 28.4).
// Each entry is a project; `root` scopes test discovery to that workspace, and
// `--project packages/shared` runs one of them.
// `@tripwise/shared` resolves through the npm workspace symlink and its `exports` field.
const workspaces = [
  "packages/shared",
  "packages/engine",
  "packages/grounding",
  "services/api",
  "web",
  "scripts",
] as const;

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: workspaces.map((dir) => ({
      test: {
        name: dir,
        root: `./${dir}`,
        include: ["**/*.test.{ts,tsx}"],
        exclude: ["**/node_modules/**", "**/dist/**"],
        environment: "node",
      },
    })),
  },
});
