import { generate } from "./generateAST.ts";

generate("specification", {
  "./scanner.ts": ["Token"],
}, {
  Expr: {
    Assign: { name: "Token", value: "Expr" },
    Binary: {
      left: "Expr",
      operator: "Token",
      right: "Expr",
    },
    Call: { operator: "Expr", paren: "Token", operands: "Expr[]" },
    Get: { object: "Expr", name: "Token" },
    Grouping: { expression: "Expr" },
    Literal: { value: "null | string | number | boolean" },
    Logical: {
      left: "Expr",
      operator: "Token",
      right: "Expr",
    },
    Set: { object: "Expr", name: "Token", value: "Expr" },
    Super: { keyword: "Token", method: "Token" },
    This: { keyword: "Token" },
    Unary: { operator: "Token", expression: "Expr" },
    Variable: { name: "Token" },
  },
  Stmt: {
    Block: { statements: "Stmt[]" },
    Callable: { name: "Token", params: "Token[]", body: "Stmt[]" },
    Class: {
      name: "Token",
      superclass: "Variable | undefined",
      methods: "Callable[]",
    },
    Expression: { expression: "Expr" },
    If: { condition: "Expr", onTrue: "Stmt", onFalse: "Stmt | undefined" },
    Print: { expression: "Expr" },
    Return: { keyword: "Token", value: "Expr | undefined" },
    Var: { name: "Token", initializer: "Expr | undefined" },
    While: { condition: "Expr", body: "Stmt" },
  },
});
