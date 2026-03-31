import { Command } from "commander";
import { version } from "./version.js";
import { configCommand } from "./commands/config.js";
import { gitCommand } from "./commands/git.js";
import { implementNextCommand } from "./commands/getReady.js";
import { testCommand } from "./commands/test.js";

const program = new Command();

program.name("automata").description("Automata CLI tool").version(version, "-v, --version");

program.addCommand(configCommand);
program.addCommand(gitCommand);
program.addCommand(implementNextCommand);
program.addCommand(testCommand);
program.showHelpAfterError();

program.parse();

if (process.argv.length <= 2) {
  program.help();
}
