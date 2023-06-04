import {
  Callable,
  Expr,
  ExprVisitor,
  Stmt,
  StmtVisitor,
  Variable,
} from "./ast.ts";
import { Interpreter } from "./interpreter.ts";
import { Token } from "./scanner.ts";

export class Resolver implements ExprVisitor<void>, StmtVisitor<void> {
  readonly scopes: Map<string, boolean>[] = [];
  currentFunction = FunctionType.NONE;
  currentClass = ClassType.NONE;
  constructor(readonly interpreter: Interpreter) {}
  visitSuper(keyword: Token, _method: Token): void {
    switch (this.currentClass) {
      case ClassType.CLASS:
        this.interpreter.logger.parseError(
          keyword,
          "Can't use 'super' in a class without superclass",
        );
        break;
      case ClassType.NONE:
        this.interpreter.logger.parseError(
          keyword,
          "Can't use 'super' outside of a class",
        );
        break;
      default:
        break;
    }
    this.resolveLocal(keyword);
  }
  visitThis(keyword: Token): void {
    if (this.currentClass === ClassType.NONE) {
      this.interpreter.logger.parseError(
        keyword,
        "Can't use 'this' outside of a class.",
      );
      return;
    }
    this.resolveLocal(keyword);
  }
  visitSet(object: Expr, _name: Token, value: Expr): void {
    this.#resolveExpr(object);
    this.#resolveExpr(value);
  }
  visitGet(object: Expr, _name: Token): void {
    this.#resolveExpr(object);
  }
  visitClass(
    name: Token,
    superclass: Variable | undefined,
    methods: Callable[],
  ): void {
    const enclosingClass = this.currentClass;
    this.currentClass = ClassType.CLASS;
    this.declare(name);
    this.define(name);
    if (superclass) {
      if (superclass.name.lexeme === name.lexeme) {
        this.interpreter.logger.parseError(
          superclass.name,
          "A class can't inherit from itself.",
        );
      }
      this.currentClass = ClassType.SUBCLASS;
      this.#resolveExpr(superclass);
      this.beginScope().set("super", true);
    }
    this.beginScope().set("this", true);
    for (const method of methods) {
      this.resolveCallable(
        method.params,
        method.body,
        method.name.lexeme === "init"
          ? FunctionType.INITIALIZER
          : FunctionType.METHOD,
      );
    }
    this.endScope();
    if (superclass) this.endScope();
    this.currentClass = enclosingClass;
  }
  visitBlock(statements: Stmt[]): void {
    this.beginScope();
    this.resolve(statements);
    this.endScope();
  }
  beginScope() {
    const scope = new Map();
    this.scopes.push(scope);
    return scope;
  }
  endScope() {
    this.scopes.pop();
  }
  resolve(statements: Stmt[]) {
    for (const statement of statements) {
      this.#resolveStmt(statement);
    }
  }
  #resolveStmt(statement: Stmt) {
    statement.accept(this);
  }
  #resolveExpr(expression: Expr) {
    expression.accept(this);
  }
  visitExpression(expression: Expr): void {
    this.#resolveExpr(expression);
  }
  visitCallable(name: Token, params: Token[], body: Stmt[]): void {
    this.declare(name);
    this.define(name);
    this.resolveCallable(params, body, FunctionType.FUNCTION);
  }
  resolveCallable(params: Token[], body: Stmt[], type: FunctionType) {
    const enclosing = this.currentFunction;
    this.currentFunction = type;
    this.beginScope();
    for (const param of params) {
      this.declare(param);
      this.define(param);
    }
    this.resolve(body);
    this.endScope();
    this.currentFunction = enclosing;
  }
  visitIf(condition: Expr, onTrue: Stmt, onFalse: Stmt | undefined): void {
    this.#resolveExpr(condition);
    this.#resolveStmt(onTrue);
    if (onFalse) this.#resolveStmt(onFalse);
  }
  visitPrint(expression: Expr): void {
    this.#resolveExpr(expression);
  }
  visitReturn(keyword: Token, value: Expr | undefined): void {
    if (this.currentFunction === FunctionType.NONE) {
      this.interpreter.logger.parseError(keyword, "Top level returns");
    }
    if (value) {
      if (this.currentFunction === FunctionType.INITIALIZER) {
        this.interpreter.logger.parseError(keyword, "Init returns value");
      }
      this.#resolveExpr(value);
    }
  }
  visitVar(name: Token, initializer: Expr | undefined): void {
    this.declare(name);
    if (initializer) {
      this.#resolveExpr(initializer);
      this.define(name); // todo: use before set still possible;
    }
  }
  define(name: Token) {
    const scope = this.#peek();
    if (!scope) return;
    scope.set(name.lexeme, true);
  }
  #peek() {
    const index = this.scopes.length - 1;
    return index < 0 ? null : this.scopes[index];
  }
  declare(name: Token) {
    const scope = this.#peek();
    if (!scope) return;
    if (scope.has(name.lexeme)) {
      this.interpreter.logger.parseError(
        name,
        `Duplicate declaration for '${name.lexeme}'`,
      );
    }
    scope.set(name.lexeme, false);
  }
  visitWhile(condition: Expr, body: Stmt): void {
    this.#resolveExpr(condition);
    this.#resolveStmt(body);
  }
  visitAssign(name: Token, value: Expr): void {
    this.#resolveExpr(value);
    this.resolveLocal(name);
  }
  visitBinary(left: Expr, _operator: Token, right: Expr): void {
    this.#resolveExpr(left);
    this.#resolveExpr(right);
  }
  visitCall(operator: Expr, _paren: Token, operands: Expr[]): void {
    this.#resolveExpr(operator);
    for (const operand of operands) {
      this.#resolveExpr(operand);
    }
  }
  visitGrouping(expression: Expr): void {
    this.#resolveExpr(expression);
  }
  visitLiteral(_value: string | number | boolean | null): void {}
  visitLogical(left: Expr, _operator: Token, right: Expr): void {
    this.#resolveExpr(left);
    this.#resolveExpr(right);
  }
  visitUnary(_operator: Token, expression: Expr): void {
    this.#resolveExpr(expression);
  }
  visitVariable(name: Token): void {
    if (this.#peek()?.get(name.lexeme) === false) {
      this.interpreter.logger.parseError(
        name,
        `Read '${name.lexeme}' before assigning a value to it.`,
      );
    }
    this.resolveLocal(name);
  }
  resolveLocal(name: Token) {
    for (let i = 0, max = this.scopes.length - 1; i <= max; i++) {
      if (this.scopes[max - i].has(name.lexeme)) {
        this.scopes[max - i].set(name.lexeme, true);
        this.interpreter.resolve(name, i);
        return;
      }
    }
  }
}

enum FunctionType {
  NONE,
  FUNCTION,
  METHOD,
  INITIALIZER,
}
enum ClassType {
  NONE,
  CLASS,
  SUBCLASS,
}
