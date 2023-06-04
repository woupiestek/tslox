import { Variable } from "./ast.ts";
import { Callable, Expr, ExprVisitor, Stmt, StmtVisitor } from "./ast.ts";
import { Token, TokenType } from "./scanner.ts";

export class Interpreter implements ExprVisitor<Value>, StmtVisitor<void> {
  readonly globals = new Environment();
  readonly locals = new Map<Token, number>();
  private environment = this.globals;
  constructor(readonly logger: Logger) {
    this.globals.define(
      "clock",
      new class extends LoxCallable {
        call(_interpreter: Interpreter, _operands: Value[]): Value {
          return Date.now() / 1000;
        }
        override arity() {
          return 0;
        }
      }(),
    );
  }
  visitSuper(keyword: Token, method: Token): Value {
    const distance = this.locals.get(keyword) as number;
    const superclass = this.environment.getAt(
      distance,
      "super",
    ) as LoxClass;
    const object = this.environment.getAt(distance - 1, "this") as LoxInstance;
    const _method = superclass.findMethod(method.lexeme); //?.bind(object)
    if (!_method) {
      throw new RuntimeError(method, `Undefined property ${method.lexeme}`);
    }
    return _method.bind(object);
  }
  visitThis(keyword: Token): Value {
    return this.lookupVariable(keyword);
  }
  visitSet(object: Expr, name: Token, value: Expr): Value {
    const instance = this.evaluate(object);
    if (instance instanceof LoxInstance) {
      return instance.set(name, this.evaluate(value));
    }
    throw new RuntimeError(name, "Only instances have properties.");
  }
  visitGet(object: Expr, name: Token): Value {
    const instance = this.evaluate(object);
    if (instance instanceof LoxInstance) return instance.get(name);
    throw new RuntimeError(name, "Only instances have properties.");
  }
  visitClass(
    name: Token,
    superclass: Variable | undefined,
    methods: Callable[],
  ): void {
    let _superclass: Value = null;
    if (superclass) {
      _superclass = this.evaluate(superclass);
      if (!(_superclass instanceof LoxClass)) {
        throw new RuntimeError(
          superclass.name,
          `Superclass ${_superclass} must be a class.`,
        );
      }
      this.environment = new Environment(this.environment);
      this.environment.define("super", _superclass);
    }

    this.environment.define(name.lexeme, null);
    const klass = new LoxClass(
      name.lexeme,
      _superclass ? _superclass as LoxClass : undefined,
      new Map(
        methods.map((
          { name, params, body },
        ) => [
          name.lexeme,
          new LoxFunction(
            name,
            params,
            body,
            this.environment,
            name.lexeme === "init",
          ),
        ]),
      ),
    );
    if (superclass) {
      this.environment = this.environment.enclosing as Environment;
    }
    this.environment.define(name.lexeme, klass);
  }
  resolve(name: Token, depth: number) {
    this.locals.set(name, depth);
  }
  visitReturn(keyword: Token, option: Expr | undefined): void {
    // yuck
    throw new Return(keyword, option ? this.evaluate(option) : null);
  }
  visitCallable(name: Token, params: Token[], body: Stmt[]): void {
    const fun = new LoxFunction(name, params, body, this.environment, false);
    this.environment.define(name.lexeme, fun);
  }
  visitCall(operator: Expr, paren: Token, operands: Expr[]): Value {
    const x = this.evaluate(operator);
    const ys = operands.map(this.evaluate.bind(this));
    if (!(x instanceof LoxCallable)) {
      throw new RuntimeError(
        paren,
        `Can only call functions and classes. ${x}`,
      );
    }
    if (operands.length !== x.arity()) {
      throw new RuntimeError(
        paren,
        `Expected ${x.arity} arguments but got ${operands.length}.`,
      );
    }
    return x.call(this, ys);
  }
  visitWhile(condition: Expr, body: Stmt): void {
    while (this.evaluate(condition)) {
      this.execute(body);
    }
  }
  visitLogical(left: Expr, operator: Token, right: Expr): Value {
    const x = this.evaluate(left);
    if (operator.type === TokenType.OR) {
      if (x) return x;
    } else if (!x) return x;
    return this.evaluate(right);
  }
  visitIf(condition: Expr, onTrue: Stmt, onFalse: Stmt | undefined): void {
    if (this.evaluate(condition)) this.execute(onTrue);
    else if (onFalse) this.execute(onFalse);
  }
  visitBlock(statements: Stmt[]): void {
    this.executeBlock(statements, new Environment(this.environment));
  }
  executeBlock(statements: Stmt[], environment: Environment) {
    const previous = this.environment;
    try {
      this.environment = environment;
      for (const statement of statements) {
        this.execute(statement);
      }
    } finally {
      this.environment = previous;
    }
  }
  visitAssign(name: Token, value: Expr): Value {
    const result = this.evaluate(value);
    const distance = this.locals.get(name);
    if (distance === undefined) this.globals.assign(name, result);
    else this.environment.assignAt(distance, name, result);
    return result;
  }
  visitVar(name: Token, initializer: Expr | undefined): void {
    this.environment.define(
      name.lexeme,
      initializer ? this.evaluate(initializer) : null,
    );
  }
  visitVariable(name: Token): Value {
    return this.lookupVariable(name);
  }
  lookupVariable(name: Token): Value {
    const distance = this.locals.get(name);
    if (distance === undefined) return this.globals.get(name);
    return this.environment.getAt(distance, name.lexeme);
  }
  visitExpression(expression: Expr): void {
    this.evaluate(expression);
  }
  visitPrint(expression: Expr): void {
    console.log(this.evaluate(expression)?.toString() || "nil");
  }
  visitLiteral(value: Value): Value {
    return value;
  }
  visitGrouping(expression: Expr): Value {
    return expression.accept(this);
  }
  visitUnary(operator: Token, expression: Expr): Value {
    const right = expression.accept(this);
    switch (operator.type) {
      case TokenType.BANG:
        return !right;
      case TokenType.MINUS:
        this.checkNumberOperand(operator, { right });
        return -(right as number);
      default:
        return null;
    }
  }
  visitBinary(left: Expr, operator: Token, right: Expr): Value {
    const x = left.accept(this);
    const y = right.accept(this);
    switch (operator.type) {
      case TokenType.GREATER:
        this.checkNumberOperand(operator, { left: x, right: y });
        return (x as number) > (y as number);
      case TokenType.GREATER_EQUAL:
        this.checkNumberOperand(operator, { left: x, right: y });
        return (x as number) >= (y as number);
      case TokenType.LESS:
        this.checkNumberOperand(operator, { left: x, right: y });
        return (x as number) < (y as number);
      case TokenType.LESS_EQUAL:
        this.checkNumberOperand(operator, { left: x, right: y });
        return (x as number) <= (y as number);
      case TokenType.MINUS:
        this.checkNumberOperand(operator, { left: x, right: y });
        return (x as number) - (y as number);
      case TokenType.PLUS:
        if (typeof x === "number" && typeof y === "number") {
          return x + y;
        }
        if (typeof x === "string" && typeof y === "string") {
          return x + y;
        }
        throw new RuntimeError(
          operator,
          "both operands must be strings or numbers",
        );
      case TokenType.SLASH:
        this.checkNumberOperand(operator, { left: x, right: y });
        return (x as number) / (y as number);
      case TokenType.STAR:
        this.checkNumberOperand(operator, { left: x, right: y });
        return (x as number) * (y as number);
      case TokenType.BANG_EQUAL:
        return x !== y;
      case TokenType.EQUAL_EQUAL:
        return x === y;
      default:
        break;
    }
    return null;
  }
  checkNumberOperand(operator: Token, operands: Record<string, Value>) {
    const keys: [string, Value][] = [];
    for (const [k, v] of Object.entries(operands)) {
      if (typeof v !== "number") keys.push([k, v]);
    }
    if (keys.length === 0) return;
    throw new RuntimeError(
      operator,
      keys.map(([k, v]) =>
        `${k} operand must be number, was ${v?.toString() || "nil"}`
      ).join(),
    );
  }
  interpret(statements: Stmt[]) {
    try {
      for (const statement of statements) {
        this.execute(statement);
      }
    } catch (e) {
      if (e instanceof RuntimeError) {
        this.logger.runtimeError(e);
        return;
      }
      throw e;
    }
  }
  stringify(value: Value) {
    if (value === null) return "nil";
    return "" + value;
  }
  evaluate(expression: Expr) {
    return expression.accept(this);
  }
  execute(statement: Stmt) {
    statement.accept(this);
  }
}
export class RuntimeError extends Error {
  constructor(readonly token: Token, message: string) {
    super(message);
  }
}
export class Return {
  constructor(readonly token: Token, readonly value: Value) {}
}
export type Value =
  | null
  | string
  | number
  | boolean
  | LoxCallable
  | LoxClass
  | LoxInstance;
export class Environment {
  readonly values = new Map<string, Value>();
  constructor(readonly enclosing: Environment | null = null) {}
  assignAt(distance: number, name: Token, value: Value) {
    this.ancestor(distance, name.lexeme).values.set(name.lexeme, value);
  }
  getAt(distance: number, name: string): Value {
    const value = this.ancestor(distance, name).values.get(name);
    return value === undefined ? null : value;
  }
  ancestor(distance: number, name: string): Environment {
    if (distance === 0) {
      return this;
    }
    if (this.enclosing === null) {
      // dead code?
      throw new Error(`Unresolvable '${name}'`);
    }
    return this.enclosing.ancestor(distance - 1, name);
  }
  define(key: string, value: Value) {
    this.values.set(key, value);
  }
  // used on globals
  get(name: Token): Value {
    if (this.values.has(name.lexeme)) {
      return this.values.get(name.lexeme) as Value;
    }
    if (this.enclosing === null) {
      throw new RuntimeError(name, `Undefined variable ${name.lexeme}.`);
    }
    return this.enclosing.get(name);
  }
  assign(name: Token, value: Value) {
    if (this.values.has(name.lexeme)) {
      return this.values.set(name.lexeme, value);
    }
    if (this.enclosing === null) {
      throw new RuntimeError(name, `Undefined variable ${name.lexeme}.`);
    }
    this.enclosing.assign(name, value);
  }
}

abstract class LoxCallable {
  abstract arity(): number;
  abstract call(interpreter: Interpreter, operands: Value[]): Value;
}
class LoxFunction extends LoxCallable {
  constructor(
    private readonly name: Token,
    private readonly params: Token[],
    private readonly body: Stmt[],
    private readonly closure: Environment,
    private readonly isInitializer: boolean,
  ) {
    super();
  }
  bind(instance: LoxInstance) {
    const environment = new Environment(this.closure);
    environment.define("this", instance);
    return new LoxFunction(
      this.name,
      this.params,
      this.body,
      environment,
      this.isInitializer,
    );
  }
  arity(): number {
    return this.params.length;
  }
  call(interpreter: Interpreter, operands: Value[]): Value {
    const environment = new Environment(this.closure);
    for (let i = 0, l = this.arity(); i < l; i++) {
      environment.define(this.params[i].lexeme, operands[i]);
    }
    try {
      interpreter.executeBlock(this.body, environment);
    } catch (e) {
      if (!(e instanceof Return)) throw e;
      if (!this.isInitializer) return e.value;
    }
    if (this.isInitializer) return this.closure.getAt(0, "this");
    return null;
  }
  toString() {
    return `<fn ${this.name.lexeme}>`;
  }
}
class LoxClass extends LoxCallable {
  constructor(
    readonly name: string,
    readonly superclass: LoxClass | undefined,
    private readonly methods: Map<string, LoxFunction>,
  ) {
    super();
  }
  arity(): number {
    return this.findMethod("init")?.arity() || 0;
  }
  call(interpreter: Interpreter, values: Value[]): Value {
    const instance = new LoxInstance(this);
    const initializer = this.findMethod("init");
    if (initializer) {
      initializer.bind(instance).call(interpreter, values);
    }
    return instance;
  }
  findMethod(lexeme: string): LoxFunction | undefined {
    return this.methods.get(lexeme) || this.superclass?.findMethod(lexeme);
  }
  toString() {
    return this.name;
  }
}
class LoxInstance {
  set(name: Token, value: Value) {
    this.fields.set(name.lexeme, value);
    return value;
  }
  readonly fields = new Map<string, Value>();
  get(name: Token): Value {
    const field = this.fields.get(name.lexeme);
    if (field) return field;
    const method = this.clazz.findMethod(name.lexeme);
    if (method) return method.bind(this);
    throw new RuntimeError(name, `Undefined property '${name.lexeme}'.`);
  }
  constructor(readonly clazz: LoxClass) {}
  toString() {
    return this.clazz + " instance";
  }
}

export class Logger {
  hadError = false;
  hadRuntimeError = false;
  report(line: number, column: number, where: string, message: string) {
    console.log(`[line: ${line} column:${column}] Error${where}: ${message}`);
    this.hadError = true;
  }
  // perhaps each stage should just collect its errors
  scanError(line: number, column: number, message: string) {
    this.report(line, column, "", message);
  }
  parseError(token: Token, message: string) {
    if (token.type === TokenType.EOF) {
      this.report(token.line, token.column, " at end", message);
    } else {
      this.report(
        token.line,
        token.column,
        " at '" + token.lexeme + "'",
        message,
      );
    }
  }
  runtimeError(error: RuntimeError) {
    console.error(
      `${error.message} [line:${error.token.line},column:${error.token.column}]`,
    );
    this.hadRuntimeError = true;
  }
}
