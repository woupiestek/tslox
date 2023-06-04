import { Scanner } from "./scanner.ts";
import { Parser } from "./parser.ts";
import { Interpreter, Logger } from "./interpreter.ts";
import { Resolver } from "./resolver.ts";
if (Deno.args.length > 1) {
  console.log("Usage: jlox [script]");
  Deno.exit(64);
}
const logger = new Logger();
const interpreter = new Interpreter(logger);
if (Deno.args.length === 1) await runFile();
else runPrompt();

async function runFile() {
  run(await Deno.readTextFile(Deno.args[0]), logger);
  if (logger.hadError) Deno.exit(65);
  if (logger.hadRuntimeError) Deno.exit(70);
}

function runPrompt() {
  for (;;) {
    let line = prompt("> ");
    if (line === null) return;
    logger.hadError = false;
    logger.hadRuntimeError = false;
    if (!line.includes(";")) {
      line = `print ${line};`;
      console.log(`Interpreting as: '${line}'`);
    }
    run(line, logger);
  }
}

function run(source: string, logger: Logger = new Logger()) {
  const scanner = new Scanner(source, logger);
  const tokens = scanner.scanTokens();
  const parser = new Parser(tokens, logger);
  const statements = parser.parse();
  if (logger.hadError) return;
  const resolver = new Resolver(interpreter);
  resolver.resolve(statements);
  if (logger.hadError) return;
  interpreter.interpret(statements);
}
