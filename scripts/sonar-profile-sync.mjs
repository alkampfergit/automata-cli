#!/usr/bin/env node
// Download the SonarCloud quality profile of this project and turn it into an ESLint rule set.
//   npm run sonar:sync
// It writes `eslint.sonar.rules.json`, which `eslint.sonar.config.js` reads. Commit that file.
// Run this script again when the quality profile changes in SonarCloud.
//
// How a Sonar rule is mapped to an ESLint rule:
//   1. `eslint-plugin-sonarjs` implements it  -> `sonarjs/<name>` (found by the S number in its docs URL)
//   2. SonarJS wraps an ESLint core or typescript-eslint rule -> that rule (named in the SonarJS `meta.ts`)
//   3. Anything else (React, Vue, security taint rules, architecture rules) is listed as skipped.
import { writeFileSync } from "node:fs";
import ts from "typescript";
import { builtinRules } from "eslint/use-at-your-own-risk";
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";
import unicorn from "eslint-plugin-unicorn";

const ORGANIZATION = "alkampfergit-github";
const PROJECT_KEY = "alkampfergit_automata-cli";
const SONAR = "https://sonarcloud.io";
const SONARJS_RULES =
  "https://raw.githubusercontent.com/SonarSource/SonarJS/master/packages/analysis/src/jsts/rules";
const OUTPUT = new URL("../eslint.sonar.rules.json", import.meta.url);

// SonarCloud reports these as Security Hotspots: a review is needed, the gate does not fail.
const HOTSPOT_RULES = new Set([
  "sonarjs/no-os-command-from-path",
  "sonarjs/publicly-writable-directories",
]);

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

async function getText(url) {
  const response = await fetch(url);
  return response.ok ? response.text() : undefined;
}

async function profileFor(language) {
  const query = new URLSearchParams({ project: PROJECT_KEY, organization: ORGANIZATION });
  const { profiles } = await getJson(`${SONAR}/api/qualityprofiles/search?${query}`);
  const profile = profiles.find((entry) => entry.language === language);
  if (!profile) throw new Error(`No ${language} quality profile for ${PROJECT_KEY}`);
  return profile;
}

// The export lists every rule of the profile; the rules search API hides some of them.
async function activeRules(profile) {
  const query = new URLSearchParams({
    language: profile.language,
    qualityProfile: profile.name,
    organization: ORGANIZATION,
  });
  const xml = await getText(`${SONAR}/api/qualityprofiles/export?${query}`);
  if (!xml) throw new Error(`Cannot export the quality profile ${profile.name}`);
  return [...xml.matchAll(/<rule>(.*?)<\/rule>/gs)].map(([, body]) => ({
    key: `${/<repositoryKey>(\w+)</.exec(body)[1]}:${/<key>(S\d+)</.exec(body)[1]}`,
    parameters: Object.fromEntries(
      [...body.matchAll(/<parameter><key>(.*?)<\/key><value>(.*?)<\/value>/gs)].map((match) => [match[1], match[2]]),
    ),
  }));
}

function sonarjsBySonarKey() {
  const bySonarKey = new Map();
  for (const [name, rule] of Object.entries(sonarjs.rules)) {
    for (const match of (rule.meta?.docs?.url ?? "").matchAll(/S(\d+)/g)) {
      bySonarKey.set(match[1], `sonarjs/${name}`);
    }
  }
  return bySonarKey;
}

function usableName(plugin, name) {
  if (plugin === "eslint" && builtinRules.has(name)) return name;
  if (plugin === "typescript-eslint" && tseslint.plugin.rules[name]) return `@typescript-eslint/${name}`;
  // Some unicorn rules target CSS or JSON only; ESLint refuses them for TypeScript files.
  const languages = unicorn.rules[name]?.meta?.languages;
  if (plugin === "unicorn" && unicorn.rules[name] && (!languages || languages.includes("js/js"))) {
    return `unicorn/${name}`;
  }
  return undefined;
}

// Read the SonarJS `meta.ts` of one rule and return the ESLint rules it wraps.
async function wrappedRules(number) {
  const meta = await getText(`${SONARJS_RULES}/S${number}/meta.ts`);
  if (!meta) return { skipped: "no SonarJS metadata" };
  const implementation = /implementation = '(\w+)'/.exec(meta)?.[1];
  const eslintId = /eslintId = '([^']+)'/.exec(meta)?.[1];
  const wrapped = [...meta.matchAll(/externalPlugin: '([^']+)', externalRule: '([^']+)'/g)].map(
    (match) => [match[1], match[2]],
  );
  const candidates = implementation === "external" ? [["eslint", eslintId], ["typescript-eslint", eslintId], ["unicorn", eslintId]] : wrapped;
  const names = candidates.map(([plugin, name]) => usableName(plugin, name)).filter(Boolean);
  if (names.length > 0) return { names: [...new Set(names)] };
  const plugins =
    implementation === "external"
      ? "external plugin rule, plugin not installed (React, Vue, Angular, accessibility and others)"
      : "wraps a rule of a plugin that is not installed";
  return { skipped: plugins };
}

// Convert a profile parameter (always text) to the type of the SonarJS default value.
function typed(value, sample) {
  if (Array.isArray(sample)) return value === "" ? [] : value.split(",");
  if (typeof sample === "number") return Number(value);
  if (typeof sample === "boolean") return value === "true";
  return value;
}

// SonarJS builds the options of a wrapped rule from the `fields` in its `config.ts`: the defaults,
// then the parameters of the quality profile, then the `customForConfiguration` transforms.
async function optionsFor(number, parameters) {
  const source = await getText(`${SONARJS_RULES}/S${number}/config.ts`);
  if (!source) return [];
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
  const { fields } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
  if (!fields) return [];
  return fields.map((element) => {
    if (!Array.isArray(element)) return element.customForConfiguration?.(element.default) ?? element.default;
    const entry = {};
    for (const property of element) {
      const given = parameters[property.field] ?? parameters[property.displayName];
      const value = given === undefined ? property.default : typed(given, property.default);
      entry[property.field] = property.customForConfiguration ? property.customForConfiguration(value) : value;
    }
    return entry;
  });
}

const profile = await profileFor("ts");
const rules = await activeRules(profile);
const pluginRules = sonarjsBySonarKey();

const enabled = {};
const sonarKeys = {};
const skipped = [];
const note = (eslintRule, sonarKey, options = []) => {
  const severity = HOTSPOT_RULES.has(eslintRule) ? "warn" : "error";
  enabled[eslintRule] = options.length > 0 ? [severity, ...options] : severity;
  sonarKeys[eslintRule] ??= [];
  sonarKeys[eslintRule].push(sonarKey);
};

await Promise.all(
  rules.map(async ({ key, parameters }) => {
    const [repository, sonarKey] = key.split(":");
    const number = sonarKey.slice(1);
    if (repository !== "typescript") {
      skipped.push({ key: sonarKey, reason: `repository ${repository} needs the full Sonar engine` });
    } else if (pluginRules.has(number)) {
      note(pluginRules.get(number), sonarKey);
    } else {
      const result = await wrappedRules(number);
      // With several wrapped rules, the options of the Sonar rule do not tell which one takes them.
      const options = result.names?.length === 1 ? await optionsFor(number, parameters) : [];
      if (result.names) {
        for (const name of result.names) note(name, sonarKey, options);
      }
      else skipped.push({ key: sonarKey, reason: result.skipped });
    }
  }),
);

const sorted = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
const output = {
  profile: { name: profile.name, key: profile.key, language: "ts", activeRuleCount: rules.length },
  rules: sorted(enabled),
  sonarKeys: sorted(sonarKeys),
  skipped: skipped.toSorted((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true })),
};
writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);

const reasons = {};
for (const { reason } of skipped) reasons[reason] = (reasons[reason] ?? 0) + 1;
console.log(`Profile "${profile.name}": ${rules.length} active rules`);
console.log(`Enabled ${Object.keys(enabled).length} ESLint rules, skipped ${skipped.length} Sonar rules:`);
for (const [reason, count] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${count}  ${reason}`);
