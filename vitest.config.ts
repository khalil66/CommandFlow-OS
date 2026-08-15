// Minimal, standalone Vitest config — deliberately NOT merged into
// vite.config.ts, which is generated/wrapped by @lovable.dev/vite-tanstack-config
// and explicitly warns against adding plugins manually (see the comment at
// the top of that file). Vitest picks up this file automatically instead of
// vite.config.ts when both are present, so app dev/build/preview behavior is
// completely unaffected by this file's existence.
//
// Uses the same "@/*" -> "./src/*" path alias as tsconfig.json (via
// vite-tsconfig-paths, already an existing dependency) so test files can
// import real source files — e.g. company-discovery.functions.ts's
// `@/integrations/supabase/auth-middleware` import — without a separate
// alias configuration to maintain.
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    server: {
      deps: {
        inline: ["@tanstack/react-start", "zod"],
      },
    },
  },
});
