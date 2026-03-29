import { Command } from "commander";
import { version } from "./version.js";

const program = new Command();

program.name("automata").description("Automata CLI tool").version(version, "-v, --version");

program.showHelpAfterError();

program.parse();

if (process.argv.length <= 2) {
  program.help();
}
