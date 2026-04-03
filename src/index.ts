import { Command } from "commander";
import { version } from "./version.js";
import { configCommand } from "./commands/config.js";
import { gitCommand } from "./commands/git.js";
import { implementNextCommand } from "./commands/getReady.js";
import { executeCommand } from "./commands/execute.js";
import { executePromptCommand } from "./commands/executePrompt.js";

const program = new Command();

program.name("automata").description("Automata CLI tool").version(version, "-v, --version");

program.addCommand(configCommand);
program.addCommand(gitCommand);
program.addCommand(implementNextCommand);
program.addCommand(executeCommand);
program.addCommand(executePromptCommand);
program.showHelpAfterError();

program.parse();

if (process.argv.length <= 2) {
  program.help();
}
