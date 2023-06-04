import { Logger } from "./interpreter.ts";
export enum TokenType {
  // Single-character tokens.
  LEFT_PAREN,
  RIGHT_PAREN,
  LEFT_BRACE,
  RIGHT_BRACE,
  COMMA,
  DOT,
  MINUS,
  PLUS,
  SEMICOLON,
  SLASH,
  STAR,

  // One or two character tokens.
  BANG,
  BANG_EQUAL,
  EQUAL,
  EQUAL_EQUAL,
  GREATER,
  GREATER_EQUAL,
  LESS,
  LESS_EQUAL,

  // Literals.
  IDENTIFIER,
  STRING,
  NUMBER,

  // Keywords.
  AND,
  CLASS,
  ELSE,
  FALSE,
  FUN,
  FOR,
  IF,
  NIL,
  OR,
  PRINT,
  RETURN,
  SUPER,
  THIS,
  TRUE,
  VAR,
  WHILE,

  EOF,
}

type Literal = null | string | number;
export class Token {
  constructor(
    readonly type: TokenType,
    readonly lexeme: string,
    readonly literal: Literal,
    readonly line: number,
    readonly column: number,
  ) {}
  toString() {
    return "(" +
      [TokenType[this.type], this.lexeme, this.literal].filter((it) => it).join(
        " ",
      ) + ")";
  }
}

const KEYWORDS: Record<string, TokenType> = {
  and: TokenType.AND,
  class: TokenType.CLASS,
  else: TokenType.ELSE,
  false: TokenType.FALSE,
  for: TokenType.FOR,
  fun: TokenType.FUN,
  if: TokenType.IF,
  nil: TokenType.NIL,
  or: TokenType.OR,
  print: TokenType.PRINT,
  return: TokenType.RETURN,
  super: TokenType.SUPER,
  this: TokenType.THIS,
  true: TokenType.TRUE,
  var: TokenType.VAR,
  while: TokenType.WHILE,
};

export class Scanner {
  tokens: Token[] = [];
  start = 0;
  current = 0;
  line = 1;
  lineStart = 0;

  constructor(readonly source: string, private logger: Logger) {}

  scanTokens() {
    while (!this.done()) {
      this.start = this.current;
      this.scanToken();
    }
    this.tokens.push(
      new Token(
        TokenType.EOF,
        "",
        null,
        this.line,
        this.current - this.lineStart,
      ),
    );
    return this.tokens;
  }
  done() {
    return this.current >= this.source.length;
  }

  advance() {
    return this.source[this.current++];
  }

  match(ch: string) {
    if (this.done() || this.source[this.current] !== ch) return false;
    this.current++;
    return true;
  }

  addToken(type: TokenType, value: Literal = null) {
    const text = this.source.substring(this.start, this.current);
    const token = new Token(
      type,
      text,
      value,
      this.line,
      this.current - this.lineStart,
    );
    this.tokens.push(token);
  }

  scanToken() {
    const ch = this.advance();
    switch (ch) {
      case "(":
        this.addToken(TokenType.LEFT_PAREN);
        break;
      case ")":
        this.addToken(TokenType.RIGHT_PAREN);
        break;
      case "{":
        this.addToken(TokenType.LEFT_BRACE);
        break;
      case "}":
        this.addToken(TokenType.RIGHT_BRACE);
        break;
      case ",":
        this.addToken(TokenType.COMMA);
        break;
      case ".":
        this.addToken(TokenType.DOT);
        break;
      case "-":
        this.addToken(TokenType.MINUS);
        break;
      case "+":
        this.addToken(TokenType.PLUS);
        break;
      case ";":
        this.addToken(TokenType.SEMICOLON);
        break;
      case "*":
        this.addToken(TokenType.STAR);
        break;
      case "!":
        this.addToken(this.match("=") ? TokenType.BANG_EQUAL : TokenType.BANG);
        break;
      case "=":
        this.addToken(
          this.match("=") ? TokenType.EQUAL_EQUAL : TokenType.EQUAL,
        );
        break;
      case "<":
        this.addToken(this.match("=") ? TokenType.LESS_EQUAL : TokenType.LESS);
        break;
      case ">":
        this.addToken(
          this.match("=") ? TokenType.GREATER_EQUAL : TokenType.GREATER,
        );
        break;
      case "/":
        if (this.match("/")) {
          while (!this.done() && this.peek() !== "\n") this.current++;
        } else if (this.match("*")) this.comment();
        else this.addToken(TokenType.SLASH);
        break;
      case " ":
      case "\r":
      case "\t":
        // Ignore whitespace.
        break;
      case "\n":
        this.nextLine();
        break;
      case '"':
        this.string();
        break;
      default:
        if (this.isDigit(ch)) this.number();
        else if (this.isAlpha(ch)) this.identifier();
        else {
          this.logger.scanError(
            this.line,
            this.current - this.lineStart,
            "Unexpected character",
          );
        }
        break;
    }
  }

  peek(offset = 0) {
    return this.source[this.current + offset];
  }
  nextLine() {
    this.line++;
    this.lineStart = this.current;
  }
  string() {
    while (this.peek() !== '"') {
      if (this.peek() === "\n") this.nextLine();
      this.current++;
    }
    if (this.done()) {
      this.logger.scanError(
        this.line,
        this.current - this.lineStart,
        "Unfinished string",
      );
      return;
    }
    this.current++;
    this.addToken(
      TokenType.STRING,
      this.source.substring(this.start + 1, this.current - 1),
    );
  }
  comment() {
    while (this.peek() !== "*" || this.peek(1) !== "/") {
      if (this.peek() === "\n") this.nextLine();
      this.current++;
    }
    this.current += 2;
  }
  isDigit(ch: string) {
    return "0" <= ch && ch <= "9";
  }
  number() {
    while (this.isDigit(this.peek())) this.current++;
    if (this.peek() === "." && this.isDigit(this.peek(1))) {
      this.current++;
      while (this.isDigit(this.peek())) this.current++;
    }
    this.addToken(
      TokenType.NUMBER,
      Number.parseFloat(this.source.substring(this.start, this.current)),
    );
  }
  isAlpha(ch: string) {
    return ("A" <= ch && ch <= "Z") || ("a" <= ch && ch <= "z") || ch === "_";
  }
  identifier() {
    while (this.isAlpha(this.peek()) || this.isDigit(this.peek())) {
      this.current++;
    }
    const text = this.source.substring(this.start, this.current);
    const type = KEYWORDS[text] || TokenType.IDENTIFIER;
    this.addToken(type);
  }
}
