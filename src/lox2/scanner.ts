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

  ERROR,
  EOF,
}

export class Token {
  constructor(
    readonly type: TokenType,
    readonly lexeme: string,
    readonly line: number,
    readonly column: number,
  ) {}
  toString() {
    return (
      "(" +
      [TokenType[this.type], this.lexeme].filter((it) => it).join(" ") +
      ")"
    );
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
  start = 0;
  current = 0;
  line = 1;
  lineStart = 0;

  constructor(readonly source: string) {}

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

  error(message: string) {
    return new Token(
      TokenType.ERROR,
      message,
      this.line,
      this.current - this.lineStart,
    );
  }

  token(type: TokenType) {
    const text = this.source.substring(this.start, this.current);
    return new Token(type, text, this.line, this.current - this.lineStart);
  }

  scanToken(): Token {
    this.skipWhiteSpace();
    this.start = this.current;
    if (this.done()) return this.token(TokenType.EOF);
    const ch = this.advance();
    switch (ch) {
      case "(":
        return this.token(TokenType.LEFT_PAREN);
      case ")":
        return this.token(TokenType.RIGHT_PAREN);
      case "{":
        return this.token(TokenType.LEFT_BRACE);
      case "}":
        return this.token(TokenType.RIGHT_BRACE);
      case ",":
        return this.token(TokenType.COMMA);
      case ".":
        return this.token(TokenType.DOT);
      case "-":
        return this.token(TokenType.MINUS);
      case "+":
        return this.token(TokenType.PLUS);
      case ";":
        return this.token(TokenType.SEMICOLON);
      case "*":
        return this.token(TokenType.STAR);
      case "!":
        return this.token(
          this.match("=") ? TokenType.BANG_EQUAL : TokenType.BANG,
        );
      case "=":
        return this.token(
          this.match("=") ? TokenType.EQUAL_EQUAL : TokenType.EQUAL,
        );
      case "<":
        return this.token(
          this.match("=") ? TokenType.LESS_EQUAL : TokenType.LESS,
        );
      case ">":
        return this.token(
          this.match("=") ? TokenType.GREATER_EQUAL : TokenType.GREATER,
        );
      case "/":
        if (this.match("/") || this.match("*")) {
          return this.error("Missed comment");
        } else return this.token(TokenType.SLASH);
      case '"':
        return this.string();
      default:
        if (this.isDigit(ch)) return this.number();
        else if (this.isAlpha(ch)) return this.identifier();
        else return this.error("Unexpected character " + ch);
    }
  }

  skipWhiteSpace() {
    for (;;) {
      switch (this.source[this.current]) {
        case "\n":
          this.nextLine();
          this.current++;
          break;
        case " ":
        case "\r":
        case "\t":
          this.current++;
          break;
        case "/":
          if (this.source[this.current + 1] !== "/") return;
          while (!this.done() && this.peek() !== "\n") this.current++;
          break;
        default:
          return;
      }
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
      return this.error("Unfinished string");
    }
    this.current++;
    return this.token(TokenType.STRING);
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
    return this.token(TokenType.NUMBER);
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
    return this.token(type);
  }
}
