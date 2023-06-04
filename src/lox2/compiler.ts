import { Chunk, LoxFunction, OpCode, Pool, Value } from "./chunk.ts";
import { Scanner, Token, TokenType } from "./scanner.ts";

function syntheticToken(text: string) {
  return new Token(TokenType.IDENTIFIER, text, 0, 0);
}

const __this = syntheticToken("this");
const __ = syntheticToken("");
const __super = syntheticToken("super");

class Parser {
  hadError = false;
  panicMode = false;
  current: Token = __;
  previous: Token = __;
  constructor(readonly scanner: Scanner) {
    this.advance();
  }
  errorAt(token: Token, message: string) {
    if (this.panicMode) return;
    this.panicMode = true;
    let log = `[line ${token.line}, column ${token.column}] Error`;

    if (token.type === TokenType.EOF) log += " at end";
    else if (token.type !== TokenType.ERROR) {
      log += ` at '${token.lexeme}': `;
    }

    console.error(log + message);
    this.hadError = true;
  }

  error(message: string) {
    this.errorAt(this.previous, message);
  }

  errorAtCurrent(message: string) {
    this.errorAt(this.current, message);
  }

  advance() {
    this.previous = this.current;

    for (;;) {
      this.current = this.scanner.scanToken();
      if (this.current.type !== TokenType.ERROR) break;

      this.errorAtCurrent(this.current.lexeme);
    }
  }

  consume(type: TokenType, message: string) {
    if (this.current.type === type) {
      this.advance();
      return;
    }

    this.errorAtCurrent(message);
  }

  check(type: TokenType): boolean {
    return this.current.type === type;
  }

  match(type: TokenType): boolean {
    if (!this.check(type)) return false;
    this.advance();
    return true;
  }

  synchronize() {
    this.panicMode = false;

    while (this.current.type !== TokenType.EOF) {
      if (this.previous.type === TokenType.SEMICOLON) return;
      switch (this.current.type) {
        case TokenType.CLASS:
        case TokenType.FUN:
        case TokenType.VAR:
        case TokenType.FOR:
        case TokenType.IF:
        case TokenType.WHILE:
        case TokenType.PRINT:
        case TokenType.RETURN:
          return;
      }
      this.advance();
    }
  }
}
enum Precedence {
  NONE,
  ASSIGNMENT, // =
  OR, // or
  AND, // and
  EQUALITY, // === !=
  COMPARISON, // < > <= >=
  TERM, // + -
  FACTOR, // * /
  UNARY, // ! -
  CALL, // . ()
  PRIMARY,
}
type ParseFn = (canAssign: boolean) => void;
type ParseRule = [ParseFn | null, ParseFn | null, Precedence];
type Local = {
  name: Token;
  depth: number;
  isCaptured: boolean;
};

type Upvalue = {
  index: number;
  isLocal: boolean;
};

enum FunctionType {
  FUNCTION,
  INITIALIZER,
  METHOD,
  SCRIPT,
}

export class Compiler {
  func: LoxFunction = new LoxFunction();
  scopeDepth = 0;
  upvalues: Upvalue[] = [];
  locals: Local[] = [];
  constructor(
    public enclosing: Compiler | null,
    public type: FunctionType,
    public klasses: boolean[],
    readonly parser: Parser,
    readonly pool: Pool,
  ) {
    if (type !== FunctionType.SCRIPT) {
      this.func.name = this.pool.intern(parser.previous.lexeme);
    }
    this.locals.push({
      depth: 0,
      isCaptured: false,
      name: type !== FunctionType.FUNCTION ? __this : __,
    });
  }

  currentChunk(): Chunk {
    return this.func.chunk;
  }
  emitByte(byte: number) {
    this.currentChunk().write(byte, this.parser.previous.line);
  }
  emitBytes(b0: number, b1: number) {
    this.emitByte(b0);
    this.emitByte(b1);
  }

  emitLoop(loopStart: number) {
    this.emitByte(OpCode.LOOP);

    const offset = this.currentChunk().count - loopStart + 2;
    if (offset > 0xffff) this.parser.error("Loop body too large.");

    this.emitByte((offset >> 8) & 0xff);
    this.emitByte(offset & 0xff);
  }

  emitJump(instruction: number): number {
    this.emitByte(instruction);
    this.emitByte(0xff);
    this.emitByte(0xff);
    return this.currentChunk().count - 2;
  }

  emitReturn() {
    if (this.type === FunctionType.INITIALIZER) {
      this.emitBytes(OpCode.GET_LOCAL, 0);
    } else this.emitByte(OpCode.NIL);
    this.emitByte(OpCode.RETURN);
  }

  makeConstant(value: Value): number {
    const constant = this.currentChunk().addConstant(value);
    if (constant > 0xff) {
      this.parser.error("Too many constants in one chunk.");
      return 0;
    }

    return constant;
  }

  emitConstant(value: Value) {
    this.emitBytes(OpCode.CONSTANT, this.makeConstant(value));
  }

  patchJump(offset: number) {
    // -2 to adjust for the bytecode for the jump offset itself.
    const jump = this.currentChunk().count - offset - 2;
    if (jump > 0xffff) this.parser.error("Too much code to jump over.");
    this.currentChunk().code[offset] = (jump >> 8) & 0xff;
    this.currentChunk().code[offset + 1] = jump & 0xff;
  }
  end() {
    this.emitReturn();
    return this.func;
  }

  beginScope() {
    this.scopeDepth++;
  }

  endScope() {
    this.scopeDepth--;
    while (
      this.locals.length > 0 &&
      this.locals[this.locals.length - 1].depth > this.scopeDepth
    ) {
      if (this.locals[this.locals.length - 1].isCaptured) {
        this.emitByte(OpCode.CLOSE_UPVALUE);
      } else this.emitByte(OpCode.POP);
      this.locals.pop();
    }
  }

  identifierConstant(name: Token): number {
    return this.makeConstant(this.pool.intern(name.lexeme));
  }

  resolveLocal(name: Token): number {
    for (let i = this.locals.length - 1; i >= 0; i--) {
      const local = this.locals[i];
      if (name.lexeme === local.name.lexeme) {
        if (local.depth === -1) {
          this.parser.error(
            "Can't read local variable in its own initializer.",
          );
        }
        return i;
      }
    }
    return -1;
  }

  addUpvalue(index: number, isLocal: boolean): number {
    const upvalueCount = this.func.upvalueCount;

    for (let i = 0; i < upvalueCount; i++) {
      const upvalue: Upvalue = this.upvalues[i];
      if (upvalue.index === index && upvalue.isLocal === isLocal) return i;
    }

    if (upvalueCount === 0x100) {
      this.parser.error("Too many closure variables in function.");
      return 0;
    }

    this.upvalues[upvalueCount] = { isLocal, index };
    return this.func.upvalueCount++;
  }

  resolveUpvalue(name: Token): number {
    if (this.enclosing === null) return -1;

    const local = this.enclosing.resolveLocal(name);
    if (local !== -1) {
      this.enclosing.locals[local].isCaptured = true;
      return this.addUpvalue(local, true);
    }
    const upvalue = this.enclosing.resolveUpvalue(name);
    if (upvalue !== -1) return this.addUpvalue(upvalue, false);

    return -1;
  }

  addLocal(name: Token) {
    if (this.locals.length === 0x100) {
      this.parser.error("Too many local variables in function.");
      return;
    }
    this.locals.push({
      name,
      depth: -1,
      isCaptured: false,
    });
  }

  declareVariable() {
    if (this.scopeDepth === 0) return;
    const name: Token = this.parser.previous;
    for (let i = this.locals.length - 1; i >= 0; i--) {
      const local = this.locals[i];
      if (local.depth !== -1 && local.depth < this.scopeDepth) break;
      if (name.lexeme === local.name.lexeme) {
        this.parser.error("Already a variable with this name in this scope.");
      }
    }
    this.addLocal(name);
  }

  and_() {
    const endJump = this.emitJump(OpCode.JUMP_IF_FALSE);

    this.emitByte(OpCode.POP);
    this.parsePrecedence(Precedence.AND);

    this.patchJump(endJump);
  }

  binary() {
    const operatorType = this.parser.previous.type;
    const rule = this.getRule(operatorType);
    this.parsePrecedence(rule[2] + 1);

    switch (operatorType) {
      case TokenType.BANG_EQUAL:
        this.emitBytes(OpCode.EQUAL, OpCode.NOT);
        break;
      case TokenType.EQUAL_EQUAL:
        this.emitByte(OpCode.EQUAL);
        break;
      case TokenType.GREATER:
        this.emitByte(OpCode.GREATER);
        break;
      case TokenType.GREATER_EQUAL:
        this.emitBytes(OpCode.LESS, OpCode.NOT);
        break;
      case TokenType.LESS:
        this.emitByte(OpCode.LESS);
        break;
      case TokenType.LESS_EQUAL:
        this.emitBytes(OpCode.GREATER, OpCode.NOT);
        break;
      case TokenType.PLUS:
        this.emitByte(OpCode.ADD);
        break;
      case TokenType.MINUS:
        this.emitByte(OpCode.SUBTRACT);
        break;
      case TokenType.STAR:
        this.emitByte(OpCode.MULTIPLY);
        break;
      case TokenType.SLASH:
        this.emitByte(OpCode.DIVIDE);
        break;
      default:
        return; // Unreachable.
    }
  }

  argumentList(): number {
    let argCount = 0;
    if (!this.parser.check(TokenType.RIGHT_PAREN)) {
      do {
        this.expression();
        if (argCount === 255) {
          this.parser.error("Can't have more than 255 arguments.");
        }
        argCount++;
      } while (this.parser.match(TokenType.COMMA));
    }

    this.parser.consume(TokenType.RIGHT_PAREN, "Expect ')' after arguments.");
    return argCount;
  }

  call() {
    const argCount = this.argumentList();
    this.emitBytes(OpCode.CALL, argCount);
  }

  dot(canAssign: boolean) {
    this.parser.consume(
      TokenType.IDENTIFIER,
      "Expect property name after '.'.",
    );
    const name = this.identifierConstant(this.parser.previous);

    if (canAssign && this.parser.match(TokenType.EQUAL)) {
      this.expression();
      this.emitBytes(OpCode.SET_PROPERTY, name);
    } else if (this.parser.match(TokenType.LEFT_PAREN)) {
      const argCount = this.argumentList();
      this.emitBytes(OpCode.INVOKE, name);
      this.emitByte(argCount);
    } else this.emitBytes(OpCode.GET_PROPERTY, name);
  }

  literal() {
    switch (this.parser.previous.type) {
      case TokenType.FALSE:
        this.emitByte(OpCode.FALSE);
        break;
      case TokenType.NIL:
        this.emitByte(OpCode.NIL);
        break;
      case TokenType.TRUE:
        this.emitByte(OpCode.TRUE);
        break;
      default:
        return; // Unreachable.
    }
  }

  grouping() {
    this.expression();
    this.parser.consume(TokenType.RIGHT_PAREN, "Expect ')' after expression.");
  }

  number() {
    this.emitConstant(Number.parseFloat(this.parser.previous.lexeme));
  }
  or_() {
    // no negate top of stack, jump_if, etc.
    const elseJump = this.emitJump(OpCode.JUMP_IF_FALSE);
    const endJump = this.emitJump(OpCode.JUMP);

    this.patchJump(elseJump);
    this.emitByte(OpCode.POP);

    this.parsePrecedence(Precedence.OR);
    this.patchJump(endJump);
  }

  string() {
    this.emitConstant(
      this.pool.intern(
        this.parser.previous.lexeme.substring(
          1,
          this.parser.previous.lexeme.length - 1,
        ),
      ),
    );
  }

  namedVariable(name: Token, canAssign: boolean) {
    let getOp, setOp: OpCode;
    let arg = this.resolveLocal(name);
    if (arg !== -1) {
      getOp = OpCode.GET_LOCAL;
      setOp = OpCode.SET_LOCAL;
    } else if ((arg = this.resolveUpvalue(name)) !== -1) {
      getOp = OpCode.GET_UPVALUE;
      setOp = OpCode.SET_UPVALUE;
    } else {
      arg = this.identifierConstant(name);
      getOp = OpCode.GET_GLOBAL;
      setOp = OpCode.SET_GLOBAL;
    }

    if (canAssign && this.parser.match(TokenType.EQUAL)) {
      this.expression();
      this.emitBytes(setOp, arg);
    } else this.emitBytes(getOp, arg);
  }

  variable(canAssign: boolean) {
    this.namedVariable(this.parser.previous, canAssign);
  }

  super_() {
    if (this.klasses.length === 0) {
      this.parser.error("Can't use 'super' outside of a class.");
    } else if (!this.klasses[this.klasses.length - 1]) {
      this.parser.error("Can't use 'super' in a class with no superclass.");
    }

    this.parser.consume(TokenType.DOT, "Expect '.' after 'super'.");
    this.parser.consume(TokenType.IDENTIFIER, "Expect superclass method name.");
    const name = this.identifierConstant(this.parser.previous);

    this.namedVariable(__this, false);
    if (this.parser.match(TokenType.LEFT_PAREN)) {
      const argCount = this.argumentList();
      this.namedVariable(__super, false);
      this.emitBytes(OpCode.SUPER_INVOKE, name);
      this.emitByte(argCount);
    } else {
      this.namedVariable(__super, false);
      this.emitBytes(OpCode.GET_SUPER, name);
    }
  }

  this_() {
    if (this.klasses.length === 0) {
      this.parser.error("Can't use 'this' outside of a class.");
      return;
    }
    this.variable(false);
  }

  unary() {
    const operatorType = this.parser.previous.type;

    // Compile the operand.
    this.parsePrecedence(Precedence.UNARY);

    // Emit the operator instruction.
    switch (operatorType) {
      case TokenType.BANG:
        this.emitByte(OpCode.NOT);
        break;
      case TokenType.MINUS:
        this.emitByte(OpCode.NEGATE);
        break;
      default:
        return; // Unreachable.
    }
  }

  rules: Record<TokenType, ParseRule> = {
    [TokenType.LEFT_PAREN]: [this.grouping, this.call, Precedence.CALL],
    [TokenType.RIGHT_PAREN]: [null, null, Precedence.NONE],
    [TokenType.LEFT_BRACE]: [null, null, Precedence.NONE],
    [TokenType.RIGHT_BRACE]: [null, null, Precedence.NONE],
    [TokenType.COMMA]: [null, null, Precedence.NONE],
    [TokenType.DOT]: [null, this.dot, Precedence.CALL],
    [TokenType.MINUS]: [this.unary, this.binary, Precedence.TERM],
    [TokenType.PLUS]: [null, this.binary, Precedence.TERM],
    [TokenType.SEMICOLON]: [null, null, Precedence.NONE],
    [TokenType.SLASH]: [null, this.binary, Precedence.FACTOR],
    [TokenType.STAR]: [null, this.binary, Precedence.FACTOR],
    [TokenType.BANG]: [this.unary, null, Precedence.NONE],
    [TokenType.BANG_EQUAL]: [null, this.binary, Precedence.EQUALITY],
    [TokenType.EQUAL]: [null, null, Precedence.NONE],
    [TokenType.EQUAL_EQUAL]: [null, this.binary, Precedence.EQUALITY],
    [TokenType.GREATER]: [null, this.binary, Precedence.COMPARISON],
    [TokenType.GREATER_EQUAL]: [null, this.binary, Precedence.COMPARISON],
    [TokenType.LESS]: [null, this.binary, Precedence.COMPARISON],
    [TokenType.LESS_EQUAL]: [null, this.binary, Precedence.COMPARISON],
    [TokenType.IDENTIFIER]: [this.variable, null, Precedence.NONE],
    [TokenType.STRING]: [this.string, null, Precedence.NONE],
    [TokenType.NUMBER]: [this.number, null, Precedence.NONE],
    [TokenType.AND]: [null, this.and_, Precedence.AND],
    [TokenType.CLASS]: [null, null, Precedence.NONE],
    [TokenType.ELSE]: [null, null, Precedence.NONE],
    [TokenType.FALSE]: [this.literal, null, Precedence.NONE],
    [TokenType.FOR]: [null, null, Precedence.NONE],
    [TokenType.FUN]: [null, null, Precedence.NONE],
    [TokenType.IF]: [null, null, Precedence.NONE],
    [TokenType.NIL]: [this.literal, null, Precedence.NONE],
    [TokenType.OR]: [null, this.or_, Precedence.OR],
    [TokenType.PRINT]: [null, null, Precedence.NONE],
    [TokenType.RETURN]: [null, null, Precedence.NONE],
    [TokenType.SUPER]: [this.super_, null, Precedence.NONE],
    [TokenType.THIS]: [this.this_, null, Precedence.NONE],
    [TokenType.TRUE]: [this.literal, null, Precedence.NONE],
    [TokenType.VAR]: [null, null, Precedence.NONE],
    [TokenType.WHILE]: [null, null, Precedence.NONE],
    [TokenType.ERROR]: [null, null, Precedence.NONE],
    [TokenType.EOF]: [null, null, Precedence.NONE],
  };

  getRule(type: TokenType) {
    return this.rules[type];
  }

  parsePrecedence(precedence: Precedence) {
    this.parser.advance();
    const prefixRule = this.getRule(this.parser.previous.type)[0];
    if (prefixRule === null) {
      this.parser.error("Expect expression.");
      return;
    }

    const canAssign = precedence <= Precedence.ASSIGNMENT;
    prefixRule.bind(this)(canAssign);

    while (precedence <= this.getRule(this.parser.current.type)[2]) {
      this.parser.advance();
      const infixRule = this.getRule(this.parser.previous.type)[1];
      if (infixRule === null) throw new Error("missing rule");
      infixRule.bind(this)(canAssign);
    }

    if (canAssign && this.parser.match(TokenType.EQUAL)) {
      this.parser.error("Invalid assignment target.");
    }
  }

  parseVariable(errorMessage: string): number {
    this.parser.consume(TokenType.IDENTIFIER, errorMessage);

    this.declareVariable();
    if (this.scopeDepth > 0) return 0;

    return this.identifierConstant(this.parser.previous);
  }

  markInitialized() {
    if (this.scopeDepth === 0) return;
    this.locals[this.locals.length - 1].depth = this.scopeDepth;
  }

  defineVariable(global: number) {
    if (this.scopeDepth > 0) this.markInitialized();
    else this.emitBytes(OpCode.DEFINE_GLOBAL, global);
  }

  expression() {
    this.parsePrecedence(Precedence.ASSIGNMENT);
  }

  block() {
    while (
      !this.parser.check(TokenType.RIGHT_BRACE) &&
      !this.parser.check(TokenType.EOF)
    ) {
      this.declaration();
    }

    this.parser.consume(TokenType.RIGHT_BRACE, "Expect '}' after block.");
  }

  fun(type: FunctionType) {
    const compiler = new Compiler(
      this,
      type,
      this.klasses,
      this.parser,
      this.pool,
    );
    compiler.beginScope();

    this.parser.consume(
      TokenType.LEFT_PAREN,
      "Expect '(' after function name.",
    );
    if (!this.parser.check(TokenType.RIGHT_PAREN)) {
      do {
        compiler.func.arity++;
        if (compiler.func.arity > 255) {
          this.parser.errorAtCurrent("Can't have more than 255 parameters.");
        }
        const constant = compiler.parseVariable("Expect parameter name.");
        compiler.defineVariable(constant);
      } while (this.parser.match(TokenType.COMMA));
    }
    this.parser.consume(TokenType.RIGHT_PAREN, "Expect ')' after parameters.");
    this.parser.consume(
      TokenType.LEFT_BRACE,
      "Expect '{' before function body.",
    );
    compiler.block();

    const func = compiler.end();
    this.emitBytes(OpCode.CLOSURE, this.makeConstant(func));

    for (let i = 0; i < func.upvalueCount; i++) {
      this.emitByte(compiler.upvalues[i].isLocal ? 1 : 0);
      this.emitByte(compiler.upvalues[i].index);
    }
  }

  method() {
    this.parser.consume(TokenType.IDENTIFIER, "Expect method name.");
    const constant = this.identifierConstant(this.parser.previous);

    let type = FunctionType.METHOD;
    if (this.parser.previous.lexeme === "init") {
      type = FunctionType.INITIALIZER;
    }

    this.fun(type);

    this.emitBytes(OpCode.METHOD, constant);
  }

  classDeclaration() {
    this.parser.consume(TokenType.IDENTIFIER, "Expect class name.");
    const className = this.parser.previous;
    const nameConstant = this.identifierConstant(this.parser.previous);
    this.declareVariable();

    this.emitBytes(OpCode.CLASS, nameConstant);
    this.defineVariable(nameConstant);

    this.klasses.push(false);

    if (this.parser.match(TokenType.LESS)) {
      this.parser.consume(TokenType.IDENTIFIER, "Expect superclass name.");
      this.variable(false);

      if (className.lexeme === this.parser.previous.lexeme) {
        this.parser.error("A class can't inherit from itself.");
      }

      this.beginScope();
      this.addLocal(syntheticToken("super"));
      this.defineVariable(0);

      this.namedVariable(className, false);
      this.emitByte(OpCode.INHERIT);
      this.klasses[this.klasses.length - 1] = true;
    }

    this.namedVariable(className, false);
    this.parser.consume(TokenType.LEFT_BRACE, "Expect '{' before class body.");
    while (
      !this.parser.check(TokenType.RIGHT_BRACE) &&
      !this.parser.check(TokenType.EOF)
    ) {
      this.method();
    }
    this.parser.consume(TokenType.RIGHT_BRACE, "Expect '}' after class body.");
    this.emitByte(OpCode.POP);

    if (this.klasses[this.klasses.length - 1]) this.endScope();

    this.klasses.pop();
  }

  funDeclaration() {
    const global = this.parseVariable("Expect function name.");
    this.markInitialized();
    this.fun(FunctionType.FUNCTION);
    this.defineVariable(global);
  }

  varDeclaration() {
    const global = this.parseVariable("Expect variable name.");

    if (this.parser.match(TokenType.EQUAL)) this.expression();
    else this.emitByte(OpCode.NIL);
    this.parser.consume(
      TokenType.SEMICOLON,
      "Expect ';' after variable declaration.",
    );

    this.defineVariable(global);
  }

  expressionStatement() {
    this.expression();
    this.parser.consume(TokenType.SEMICOLON, "Expect ';' after expression.");
    this.emitByte(OpCode.POP);
  }

  forStatement() {
    this.beginScope();
    this.parser.consume(TokenType.LEFT_PAREN, "Expect '(' after 'for'.");
    if (!this.parser.match(TokenType.SEMICOLON)) {
      if (this.parser.match(TokenType.VAR)) this.varDeclaration();
      else this.expressionStatement();
    }
    let loopStart = this.currentChunk().count;
    let exitJump = -1;
    if (!this.parser.match(TokenType.SEMICOLON)) {
      this.expression();
      this.parser.consume(
        TokenType.SEMICOLON,
        "Expect ';' after loop condition.",
      );

      // Jump out of the loop if the condition is false.
      exitJump = this.emitJump(OpCode.JUMP_IF_FALSE);
      this.emitByte(OpCode.POP); // Condition..
    }

    if (!this.parser.match(TokenType.RIGHT_PAREN)) {
      const bodyJump = this.emitJump(OpCode.JUMP);
      const incrementStart = this.currentChunk().count;
      this.expression();
      this.emitByte(OpCode.POP);
      this.parser.consume(
        TokenType.RIGHT_PAREN,
        "Expect ')' after for clauses.",
      );

      this.emitLoop(loopStart);
      loopStart = incrementStart;
      this.patchJump(bodyJump);
    }

    this.statement();
    this.emitLoop(loopStart);
    if (exitJump !== -1) {
      this.patchJump(exitJump);
      this.emitByte(OpCode.POP); // Condition.
    }
    this.endScope();
  }

  ifStatement() {
    this.parser.consume(TokenType.LEFT_PAREN, "Expect '(' after 'if'.");
    this.expression();
    this.parser.consume(TokenType.RIGHT_PAREN, "Expect ')' after condition.");

    const thenJump = this.emitJump(OpCode.JUMP_IF_FALSE);
    this.emitByte(OpCode.POP);
    this.statement();
    const elseJump = this.emitJump(OpCode.JUMP);
    this.patchJump(thenJump);
    this.emitByte(OpCode.POP);
    if (this.parser.match(TokenType.ELSE)) this.statement();
    this.patchJump(elseJump);
  }

  printStatement() {
    this.expression();
    this.parser.consume(TokenType.SEMICOLON, "Expect ';' after value.");
    this.emitByte(OpCode.PRINT);
  }

  returnStatement() {
    if (this.type === FunctionType.SCRIPT) {
      this.parser.error("Can't return from top-level code.");
    }

    if (this.parser.match(TokenType.SEMICOLON)) this.emitReturn();
    else {
      if (this.type === FunctionType.INITIALIZER) {
        this.parser.error("Can't return a value from an initializer.");
      }

      this.expression();
      this.parser.consume(
        TokenType.SEMICOLON,
        "Expect ';' after return value.",
      );
      this.emitByte(OpCode.RETURN);
    }
  }

  whileStatement() {
    const loopStart = this.currentChunk().count;
    this.parser.consume(TokenType.LEFT_PAREN, "Expect '(' after 'while'.");
    this.expression();
    this.parser.consume(TokenType.RIGHT_PAREN, "Expect ')' after condition.");

    const exitJump = this.emitJump(OpCode.JUMP_IF_FALSE);
    this.emitByte(OpCode.POP);
    this.statement();
    this.emitLoop(loopStart);

    this.patchJump(exitJump);
    this.emitByte(OpCode.POP);
  }

  declaration() {
    if (this.parser.match(TokenType.CLASS)) this.classDeclaration();
    else if (this.parser.match(TokenType.FUN)) this.funDeclaration();
    else if (this.parser.match(TokenType.VAR)) this.varDeclaration();
    else this.statement();

    if (this.parser.panicMode) this.parser.synchronize();
  }

  statement() {
    if (this.parser.match(TokenType.PRINT)) this.printStatement();
    else if (this.parser.match(TokenType.FOR)) this.forStatement();
    else if (this.parser.match(TokenType.IF)) this.ifStatement();
    else if (this.parser.match(TokenType.RETURN)) this.returnStatement();
    else if (this.parser.match(TokenType.WHILE)) this.whileStatement();
    else if (this.parser.match(TokenType.LEFT_BRACE)) {
      this.beginScope();
      this.block();
      this.endScope();
    } else this.expressionStatement();
  }
}

export function compile(source: string, pool: Pool) {
  const scanner = new Scanner(source);
  const parser = new Parser(scanner);
  const compiler = new Compiler(null, FunctionType.SCRIPT, [], parser, pool);
  while (!parser.match(TokenType.EOF)) compiler.declaration();
  const fun = compiler.end();
  return parser.hadError ? null : fun;
}
