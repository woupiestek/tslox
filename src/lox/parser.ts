import {
  Assign,
  Binary,
  Block,
  Call,
  Callable,
  Class,
  Expr,
  Expression,
  Get,
  Grouping,
  If,
  Literal,
  Logical,
  Print,
  Return,
  Set,
  Stmt,
  Super,
  This,
  Unary,
  Var,
  Variable,
  While,
} from "./ast.ts";
import { Logger } from "./interpreter.ts";
import { Token, TokenType } from "./scanner.ts";

export class Parser {
  current = 0;
  constructor(readonly tokens: Token[], private logger: Logger) {}
  expression(): Expr {
    return this.assignment();
  }
  assignment(): Expr {
    const expr = this.or();
    if (this.match(TokenType.EQUAL)) {
      const equals = this.token(-1);
      const value = this.assignment();
      if (expr instanceof Variable) {
        return new Assign(expr.name, value);
      } else if (expr instanceof Get) {
        return new Set(expr.object, expr.name, value);
      }
      this.error(equals, "Invalid assignment target.");
    }
    return expr;
  }
  or(): Expr {
    return this.logical(this.and, TokenType.OR);
  }
  and(): Expr {
    return this.logical(this.equality, TokenType.OR);
  }
  logical(parser: () => Expr, ...operatorTypes: TokenType[]): Expr {
    let expr: Expr = parser.bind(this)();
    while (this.match(...operatorTypes)) {
      const operator = this.token(-1);
      const right = parser.bind(this)();
      expr = new Logical(expr, operator, right);
    }
    return expr;
  }
  equality(): Expr {
    return this.binary(
      this.comparison,
      TokenType.EQUAL_EQUAL,
      TokenType.BANG_EQUAL,
    );
  }

  binary(parser: () => Expr, ...operatorTypes: TokenType[]): Expr {
    let expr: Expr = parser.bind(this)();
    while (this.match(...operatorTypes)) {
      const operator = this.token(-1);
      const right = parser.bind(this)();
      expr = new Binary(expr, operator, right);
    }
    return expr;
  }

  token(offset = 0): Token {
    return (
      this.tokens[this.current + offset] || this.tokens[this.tokens.length - 1]
    );
  }
  match(...types: TokenType[]) {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
  }
  check(type: TokenType): boolean {
    return this.token()?.type === type;
  }
  advance() {
    if (!this.done()) this.current++;
    return this.token(-1);
  }
  done() {
    return this.check(TokenType.EOF);
  }
  comparison(): Expr {
    return this.binary(
      this.term,
      TokenType.GREATER,
      TokenType.GREATER_EQUAL,
      TokenType.LESS,
      TokenType.LESS_EQUAL,
    );
  }
  term(): Expr {
    return this.binary(this.factor, TokenType.PLUS, TokenType.MINUS);
  }
  factor(): Expr {
    return this.binary(this.unary, TokenType.SLASH, TokenType.STAR);
  }
  unary(): Expr {
    if (this.match(TokenType.BANG, TokenType.MINUS)) {
      const token = this.token(-1) as Token;
      const right = this.unary();
      return new Unary(token, right);
    }
    return this.call();
  }
  call(): Expr {
    let operator = this.primary();
    while (true) {
      if (this.match(TokenType.LEFT_PAREN)) {
        operator = this.finishCall(operator);
      } else if (this.match(TokenType.DOT)) {
        const name = this.consume(
          TokenType.IDENTIFIER,
          "Expect property name after '.'.",
        );
        operator = new Get(operator, name);
      } else break;
    }
    return operator;
  }
  finishCall(operator: Expr): Expr {
    const operands: Expr[] = [];
    if (!this.check(TokenType.RIGHT_PAREN)) {
      do {
        if (arguments.length >= 255) {
          this.error(this.token(), "Can't have more than 255 arguments.");
        }
        operands.push(this.expression());
      } while (this.match(TokenType.COMMA));
    }
    const paren = this.consume(
      TokenType.RIGHT_PAREN,
      "Expect ')' after arguments.",
    );
    return new Call(operator, paren, operands);
  }
  primary(): Expr {
    if (this.match(TokenType.FALSE)) return new Literal(false);
    if (this.match(TokenType.TRUE)) return new Literal(true);
    if (this.match(TokenType.NIL)) return new Literal(null);
    if (this.match(TokenType.NUMBER, TokenType.STRING)) {
      return new Literal(this.token(-1).literal);
    }
    if (this.match(TokenType.LEFT_PAREN)) {
      const expr = this.expression();
      this.consume(TokenType.RIGHT_PAREN, "Expect ')' after expression.");
      return new Grouping(expr);
    }
    if (this.match(TokenType.SUPER)) {
      const keyword = this.token(-1);
      this.consume(TokenType.DOT, "Expect '.' after 'super'.");
      const method = this.consume(
        TokenType.IDENTIFIER,
        "Expect superclass method name.",
      );
      return new Super(keyword, method);
    }
    if (this.match(TokenType.THIS)) return new This(this.token(-1));
    if (this.match(TokenType.IDENTIFIER)) return new Variable(this.token(-1));
    throw this.error(this.token(), "Expect expression.");
  }
  consume(type: TokenType, message: string) {
    if (this.check(type)) {
      return this.advance();
    }
    throw this.error(this.token(), message);
  }
  error(token: Token, message: string) {
    this.logger.parseError(token, message);
    return new ParseError();
  }
  synchronize() {
    this.advance();
    while (!this.done()) {
      if (this.token(-1).type === TokenType.SEMICOLON) return;
      if (
        [
          TokenType.CLASS,
          TokenType.FUN,
          TokenType.VAR,
          TokenType.FOR,
          TokenType.IF,
          TokenType.WHILE,
          TokenType.PRINT,
          TokenType.RETURN,
        ].includes(this.token().type)
      ) {
        return;
      }
      this.advance();
    }
  }
  parse(): Stmt[] {
    const statements: Stmt[] = [];
    while (!this.done()) {
      statements.push(this.declaration());
    }
    return statements;
  }
  declaration(): Stmt {
    try {
      if (this.match(TokenType.FUN)) return this.callable("function");
      if (this.match(TokenType.VAR)) return this.varDeclaration();
      return this.statement();
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      this.synchronize();
      return new Expression(this.NIL);
    }
  }
  callable(kind: string): Callable {
    const name = this.consume(TokenType.IDENTIFIER, `Expect ${kind} name.`);
    const parameters: Token[] = [];
    this.consume(TokenType.LEFT_PAREN, `Expect '(' after ${kind} name.`);
    if (!this.check(TokenType.RIGHT_PAREN)) {
      do {
        if (parameters.length >= 255) {
          this.error(this.token(), "Can't have more than 255 parameters.");
        }
        parameters.push(
          this.consume(TokenType.IDENTIFIER, "Expect parameter name."),
        );
      } while (this.match(TokenType.COMMA));
    }
    this.consume(TokenType.RIGHT_PAREN, "Expect ')' after parameters.");
    this.consume(TokenType.LEFT_BRACE, "Expect '{' before function body.");
    const statements = this.block();
    return new Callable(name, parameters, statements);
  }
  statement(): Stmt {
    if (this.match(TokenType.CLASS)) return this.classDeclaration();
    if (this.match(TokenType.FOR)) return this.forStatement();
    if (this.match(TokenType.IF)) return this.ifStatement();
    if (this.match(TokenType.LEFT_BRACE)) return new Block(this.block());
    if (this.match(TokenType.PRINT)) return this.printStatement();
    if (this.match(TokenType.RETURN)) return this.returnStatement();
    if (this.match(TokenType.WHILE)) return this.whileStatement();
    return this.expressionStatement();
  }
  classDeclaration(): Stmt {
    const name = this.consume(TokenType.IDENTIFIER, "Expect class name.");
    const superclass = this.match(TokenType.LESS)
      ? new Variable(
        this.consume(TokenType.IDENTIFIER, "Expect superclass name."),
      )
      : undefined;
    this.consume(TokenType.LEFT_BRACE, "Expect '{' before class body.");
    const methods: Callable[] = [];
    while (!this.check(TokenType.RIGHT_BRACE) && !this.done()) {
      methods.push(this.callable("method"));
    }
    this.consume(TokenType.RIGHT_BRACE, "Expect '}' after class body.");
    return new Class(name, superclass, methods);
  }
  returnStatement(): Stmt {
    const keyword = this.token(-1);
    let value: Expr | undefined = undefined;
    if (!this.check(TokenType.SEMICOLON)) {
      value = this.expression();
    }
    this.consume(TokenType.SEMICOLON, "Expect ';' after return value.");
    return new Return(keyword, value); // used before assigned...
  }
  // desugaring for
  forStatement(): Stmt {
    this.consume(TokenType.LEFT_PAREN, "Expect '(' after 'for'.");
    let initializer = null;
    if (this.match(TokenType.SEMICOLON)) {
      initializer = null;
    } else if (this.match(TokenType.VAR)) {
      initializer = this.varDeclaration();
    } else {
      initializer = this.expressionStatement();
    }
    let condition = null;
    if (!this.check(TokenType.SEMICOLON)) {
      condition = this.expression();
    }
    this.consume(TokenType.SEMICOLON, "Expect ';' after loop condition.");
    let increment = null;
    if (!this.check(TokenType.RIGHT_PAREN)) {
      increment = this.expression();
    }
    this.consume(TokenType.RIGHT_PAREN, "Expect ')' after for clauses.");
    let body = this.statement();
    if (increment) body = new Block([body, new Expression(increment)]);

    body = new While(condition ? condition : new Literal(true), body);
    if (initializer) body = new Block([initializer, body]);
    return body;
  }
  whileStatement(): Stmt {
    this.consume(TokenType.LEFT_PAREN, "Expect '(' after 'while'.");
    const condition = this.expression();
    this.consume(TokenType.RIGHT_PAREN, "Expect ')' after condition.");
    const body = this.statement();
    return new While(condition, body);
  }
  ifStatement(): Stmt {
    this.consume(TokenType.LEFT_PAREN, "Expect '(' after 'if'.");
    const condition = this.expression();
    this.consume(TokenType.RIGHT_PAREN, "Expect ')' after 'if' condition.");
    const onTrue = this.statement();
    return new If(
      condition,
      onTrue,
      this.match(TokenType.ELSE) ? this.statement() : undefined,
    );
  }
  block(): Stmt[] {
    const statements: Stmt[] = [];
    while (!this.done() && !this.check(TokenType.RIGHT_BRACE)) {
      statements.push(this.declaration());
    }
    this.consume(TokenType.RIGHT_BRACE, "Expect '}' after block.");
    return statements;
  }
  printStatement() {
    const expr = this.expression();
    this.consume(TokenType.SEMICOLON, "Expect ';' after expression");
    return new Print(expr);
  }
  expressionStatement() {
    const expr = this.expression();
    this.consume(TokenType.SEMICOLON, "Expect ';' after expression");
    return new Expression(expr);
  }
  NIL = new Literal(null);
  varDeclaration() {
    const name = this.consume(TokenType.IDENTIFIER, "Expect variable name");
    let initializer: Expr | undefined = undefined;
    if (this.match(TokenType.EQUAL)) {
      initializer = this.expression();
    }
    this.consume(TokenType.SEMICOLON, "Expect ';' after variable declaration.");
    return new Var(name, initializer);
  }
}
export class ParseError extends Error {}
