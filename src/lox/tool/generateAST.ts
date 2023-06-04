// create ast.ts with classes for each type of expression
// idea: essentially generate classes from a grammar

export type Specification = Record<
  string,
  Record<string, Record<string, string>>
>;

function acceptSignature(baseName: string) {
  return `accept<R>(visitor: ${baseName}Visitor<R>): R`;
}
function baseInterface(baseName: string) {
  return `export interface ${baseName} {\n  ${acceptSignature(baseName)};\n}`;
}
function generateVisitor(
  baseName: string,
  classes: Record<string, Record<string, string>>,
) {
  return `export interface ${baseName}Visitor<R> {${
    Object.entries(classes)
      .map(([k, v]) => visitorMethod(k, v))
      .join("")
  }\n}`;
}
function visitorMethod(className: string, members: Record<string, string>) {
  return `\n  visit${className}(${
    Object.entries(members)
      .map(([k, v]) => `\n    ${k}: ${v},`)
      .join("")
  }\n  ): R;`;
}
function toStringMethod(className: string, members: Record<string, string>) {
  const strings = Object.keys(members).map((key) => `this.${key}?.toString()`); //.join(' + " " + ')
  strings.unshift(`"${className}"`);
  const body = `[${
    strings
      .map((it) => `\n      ${it},`)
      .join("")
  }\n    ].filter((it) => it).join(" ")`;
  return `toString() {\n    const body = ${body};\n    return "(" + body + ")";\n  }`;
}
function generateClass(
  baseName: string,
  className: string,
  members: Record<string, string>,
) {
  const lines: string[] = [
    `constructor(${
      Object.entries(members)
        .map(([k, v]) => `\n    readonly ${k}: ${v},`)
        .join("")
    }\n  ) {}`,
    `${acceptSignature(baseName)} {`,
    `  return visitor.visit${className}(${
      Object.keys(members)
        .map((k) => `\n      this.${k},`)
        .join("")
    }\n    );`,
    "}",
    toStringMethod(className, members),
  ];
  return `export class ${className} implements ${baseName} {${
    lines
      .map((line) => "\n  " + line)
      .join("")
  }\n}`;
}
function generatePattern(
  baseName: string,
  classes: Record<string, Record<string, string>>,
) {
  return [
    generateVisitor(baseName, classes),
    baseInterface(baseName),
    ...Object.entries(classes).map(([k, v]) => generateClass(baseName, k, v)),
  ];
}
function generateFileContent(
  imports: Record<string, string[]>,
  specification: Specification,
) {
  const parts = Object.entries(imports).map(([k, v]) =>
    `import { ${v.join(", ")} } from "${k}";`
  );
  for (const [k, v] of Object.entries(specification)) {
    parts.push(...generatePattern(k, v));
  }
  return parts.join("\n");
}
export function generate(
  scriptName: string,
  imports: Record<string, string[]>,
  specification: Specification,
) {
  if (Deno.args.length !== 1) {
    console.log(`Usage: ${scriptName} [target directory]`);
    Deno.exit(64);
  }
  Deno.writeTextFileSync(
    Deno.args[0] + "/ast.ts",
    generateFileContent(imports, specification),
  );
}
