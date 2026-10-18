// Local stand-in for the SonarCloud analysis. It enables the rules of the SonarCloud quality
// profile of this project, and no other rule, so the report shows only Sonar findings.
// `eslint.sonar.rules.json` comes from `npm run sonar:sync`. Run the check with `npm run sonar:local`.
// The normal lint stays in `eslint.config.js`.
import { readFileSync } from "node:fs";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

const { rules } = JSON.parse(readFileSync(new URL("./eslint.sonar.rules.json", import.meta.url), "utf8"));

// SonarCloud reports no rule finding in `tests/` for this project, so the rules cover `src/` only.
export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "vendor/", "specs/", "tests/"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: "./tsconfig.json", tsconfigRootDir: import.meta.dirname },
    },
    plugins: { sonarjs, unicorn, "@typescript-eslint": tseslint.plugin },
    rules,
  },
);
