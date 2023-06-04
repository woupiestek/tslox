import { Pool } from "./chunk.ts";
import { InterpretResult, VM } from "./vm.ts";

const pool: Pool = new Pool();
const vm: VM = new VM(pool);

function repl() {
  for (;;) {
    const line = prompt("> ");
    if (line === null) return;
    vm.interpret(line);
  }
}

async function runFile(path: string) {
  const source = await Deno.readTextFile(path);
  const result = vm.interpret(source);
  if (result === InterpretResult.COMPILE_ERROR) {
    Deno.exit(65);
  }
  if (result === InterpretResult.RUNTIME_ERROR) {
    Deno.exit(70);
  }
}

if (Deno.args.length === 0) {
  repl();
} else if (Deno.args.length === 1) {
  runFile(Deno.args[0]);
} else {
  console.error("Usage: main [path]\n");
  Deno.exit(64);
}
