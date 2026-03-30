import { Command } from "commander";
import { version } from "./version.js";
import { configCommand } from "./commands/config.js";

const program = new Command();

program.name("automata").description("Automata CLI tool").version(version, "-v, --version");

program.addCommand(configCommand);
program.showHelpAfterError();

program.parse();

if (process.argv.length <= 2) {
  program.help();
}
