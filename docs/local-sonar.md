# Local SonarCloud check

This page explains how to run the rules of a SonarCloud quality profile on your own machine, and how to set up the
same check in another repository. You do not need a build, a token or a push.

## Why this exists

SonarCloud runs as Automatic Analysis on this repository. It does not run in `ci.yml`, and you cannot start it from your
machine. You see its result only after a push. The local check gives you most of that result before you commit.

You cannot run the real scanner locally without a token, and without turning off Automatic Analysis. This check does
not publish anything to SonarCloud. It reads the rules from the public SonarCloud API, and it runs them with ESLint.

## Daily use

```bash
npm run sonar:local                      # files in src/ that differ from origin/develop
npm run sonar:local -- --base <ref>      # compare with another ref
npm run sonar:local -- --all             # every file in src/
npm run sonar:sync                       # download the quality profile again (needs network)
```

`sonar:local` works offline. It runs two checks and exits with `1` if one of them fails:

| Check | Tool | Notes |
|---|---|---|
| Code smells, bugs, vulnerabilities | ESLint with `eslint.sonar.config.js` | Rules come from `eslint.sonar.rules.json`. The default mode checks changed files only, because the quality gate looks at new code only. |
| Duplication | `jscpd` | Fails above 3% across `src/` and `tests/`. |

Run `npm run sonar:sync` when the quality profile changes in SonarCloud, and commit the new `eslint.sonar.rules.json`.

## How it works

### 1. Read the quality profile

SonarCloud serves the quality profile of a public project without a token:

```
GET https://sonarcloud.io/api/qualityprofiles/search?project=<project-key>&organization=<organization>
GET https://sonarcloud.io/api/qualityprofiles/export?language=ts&qualityProfile=<name>&organization=<organization>
```

Use the export. It lists every rule of the profile and the parameters that were changed. The `api/rules/search`
endpoint hides some rules: it returned 472 rules where the export returned 496.

### 2. Map each Sonar rule to an ESLint rule

`scripts/sonar-profile-sync.mjs` does the mapping:

1. **`eslint-plugin-sonarjs`.** The `meta.docs.url` of each rule contains the Sonar number, for example
   `.../rspec/S3776/...`. The script matches on that number.
2. **Wrapped ESLint rules.** SonarJS implements many rules as a wrapper around an ESLint core, `typescript-eslint` or
   `unicorn` rule. The SonarJS repository is public. For rule `Sxxxx`, the file
   `packages/analysis/src/jsts/rules/Sxxxx/meta.ts` names the wrapped rule (`eslintId` or `externalRules`).
3. **Options.** The file `config.ts` in the same folder holds the default options in `fields`. The script transpiles it
   with `typescript`, imports it, applies the parameters of the profile, and then applies each
   `customForConfiguration` transform. Without these options, the local run reports many findings that SonarCloud
   does not report.
4. **Skipped rules.** The script lists every other rule under `skipped` in `eslint.sonar.rules.json`, with the reason:
   the taint-analysis rules (`tssecurity`) and the architecture rules (`tsarchitecture`) need the full Sonar engine,
   and some rules need plugins that the repository does not use (React, Vue, Angular, accessibility).

Rules that SonarCloud reports as Security Hotspots (`no-os-command-from-path`, `publicly-writable-directories`) are
warnings, because they need a review but do not fail the gate by themselves.

### 3. Run the rules

`eslint.sonar.config.js` loads `eslint.sonar.rules.json` and enables exactly those rules, and no others. The normal lint
stays in `eslint.config.js` and is not changed. `scripts/sonar-local.sh` selects the files, runs ESLint, and then runs
`jscpd` for duplication.

## Set it up in another repository

### Prerequisites

- A SonarCloud project that is public. For a private project, every API call needs a token
  (`Authorization: Bearer <token>`). This was not tested.
- Node.js and ESLint 9 or newer in the repository, with `typescript-eslint` configured.

### Steps

1. **Find the identifiers.** The project key and the organization key are in the SonarCloud URL. You can also read
   them from the API:

   ```bash
   curl -s 'https://sonarcloud.io/api/components/show?component=<project-key>'
   ```

   The result contains the organization key. Check `ci.yml` for a Sonar step. If there is none, the project uses
   Automatic Analysis.

2. **Copy three files** from this repository: `scripts/sonar-profile-sync.mjs`, `scripts/sonar-local.sh`,
   `eslint.sonar.config.js`. Make the shell script executable (`chmod +x scripts/sonar-local.sh`).

3. **Install the dev dependencies:**

   ```bash
   npm install --save-dev eslint-plugin-sonarjs eslint-plugin-unicorn jscpd typescript-eslint
   ```

4. **Add the npm scripts:**

   ```bash
   npm pkg set scripts.sonar:sync="node scripts/sonar-profile-sync.mjs"
   npm pkg set scripts.sonar:local="bash scripts/sonar-local.sh"
   ```

5. **Edit the values that belong to the repository:**

   | File | Value | Change it to |
   |---|---|---|
   | `scripts/sonar-profile-sync.mjs` | `ORGANIZATION`, `PROJECT_KEY` | the identifiers from step 1 |
   | `scripts/sonar-profile-sync.mjs` | `profileFor("ts")` | `"js"` for a JavaScript repository |
   | `scripts/sonar-local.sh` | `BASE`, `PATHS`, `RULE_PATHS` | the base branch and the source folders |
   | `eslint.sonar.config.js` | `files`, `ignores`, `project` | the source folders and the `tsconfig.json` path |

6. **Generate the rules and run the check:**

   ```bash
   npm run sonar:sync
   npm run sonar:local -- --all
   ```

   Commit `eslint.sonar.rules.json`.

7. **Calibrate against the real result.** This step is the most important. Do not trust the first run.

   ```bash
   # Real open issues of the project, grouped by rule
   curl -s 'https://sonarcloud.io/api/issues/search?componentKeys=<project-key>&resolved=false&ps=1&facets=rules'
   # Real duplication
   curl -s 'https://sonarcloud.io/api/measures/component?component=<project-key>&metricKeys=duplicated_lines_density,ncloc'
   curl -s 'https://sonarcloud.io/api/measures/search_history?component=<project-key>&metrics=duplicated_lines_density'
   ```

   Compare these results with the output of `npm run sonar:local -- --all`, rule by rule (the
   `sonarKeys` object in `eslint.sonar.rules.json` maps each ESLint rule to its Sonar number). Then adjust:

   - A rule that the local run reports and SonarCloud never reports: check its options in the SonarJS `config.ts`
     and check whether SonarJS suppresses it for some files.
   - Folders without any real finding, for example `tests/`: remove them from the rule scope.
   - Duplication: raise or lower `--min-tokens` in `scripts/sonar-local.sh` until `jscpd` is close to the real value.

## Known limits

The local check is an approximation. On `develop` of this repository, it finds the four issues that SonarCloud
reports, at the same lines. It also reports eight findings that SonarCloud does not report.

- **Extra findings.** SonarJS suppresses some reports inside its own rule wrappers. The local check does not copy this.
  `no-await-in-loop` (`S9382`) is the most frequent example. Check such a finding before you change the code. Do not hide
  it with a suppression comment.
- **Missing rules.** The skipped rules are never checked. A pass does not guarantee a green quality gate.
- **Not computed.** The quality gate also uses the review of Security Hotspots and the maintainability ratings. The local
  check does not compute them.
- **Duplication.** `jscpd` counts tokens differently from Sonar. At 100 tokens it reported 2.05% where SonarCloud
  reported 0.0%. This repository uses 150 tokens (0.40%). Calibrate this value for every repository.
- **Tests.** SonarCloud reports no rule finding in `tests/` for this repository, so the rules cover `src/` only. This
  can be different in another repository.
- **SonarJS layout.** The sync script reads the `master` branch of the SonarJS repository. If SonarJS moves its rule
  folders, a rule gets no `meta.ts`, and the script puts it in the `skipped` list without an error. Compare the number of
  enabled rules after each sync.

To read the real result of a pull request, use the `sonar-quality-gate` skill.
