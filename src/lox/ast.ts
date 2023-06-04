import { Token } from "./scanner.ts";
export interface ExprVisitor<R> {
  visitAssign(
    name: Token,
    value: Expr,
  ): R;
  visitBinary(
    left: Expr,
    operator: Token,
    right: Expr,
  ): R;
  visitCall(
    operator: Expr,
    paren: Token,
    operands: Expr[],
  ): R;
  visitGet(
    object: Expr,
    name: Token,
  ): R;
  visitGrouping(
    expression: Expr,
  ): R;
  visitLiteral(
    value: null | string | number | boolean,
  ): R;
  visitLogical(
    left: Expr,
    operator: Token,
    right: Expr,
  ): R;
  visitSet(
    object: Expr,
    name: Token,
    value: Expr,
  ): R;
  visitSuper(
    keyword: Token,
    method: Token,
  ): R;
  visitThis(
    keyword: Token,
  ): R;
  visitUnary(
    operator: Token,
    expression: Expr,
  ): R;
  visitVariable(
    name: Token,
  ): R;
}
export interface Expr {
  accept<R>(visitor: ExprVisitor<R>): R;
}
export class Assign implements Expr {
  constructor(
    readonly name: Token,
    readonly value: Expr,
  ) {}
  accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.visitAssign(
      this.name,
      this.value,
    );
  }
  toString() {
    const body = [
      "Assign",
      this.name?.toString(),
      this.value?.toString(),
    ].filter((it) => it).join(" ");
    return "(" + body + ")";
  }
}
export class Binary implements Expr {
  constructor(
    readonly left: Expr,
    readonly operator: Token,
    readonly right: Expr,
  ) {}
  accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.visitBinary(
      this.left,
      this.operator,
      this.right,
    );
  }
  toString() {
    const body = [
      "Binary",
      this.left?.toString(),
      this.operator?.toString(),
      this.right?.toString(),
    ].filter((it) => it).join(" ");
    return "(" + body + ")";
  }
}
export class Call implements Expr {
  constructor(
    readonly operator: Expr,
    readonly paren: Token,
    readonly operands: Expr[],
  ) {}
  accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.visitCall(
      this.operator,
      this.paren,
      this.operands,
    );
  }
  toString() {
    const body = [
      "Call",
      this.operator?.toString(),
      this.paren?.toString(),
      this.operands?.toString(),
    ].filter((it) => it).join(" ");
    return "(" + body + ")";
  }
}
export class Get implements Expr {
  constructor(
    readonly object: Expr,
    readonly name: Token,
  ) {}
  accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.visitGet(
      this.object,
      this.name,
    );
  }
  toString() {
    const body = [
      "Get",
      this.object?.toString(),
      this.name?.toString(),
    ].filter((it) => it).join(" ");
    return "(" + body + ")";
  }
}
export class Grouping implements Expr {
  constructor(
    readonly expression: Expr,
  ) {}
  accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.visitGrouping(
      this.expression,
    );
  }
  toString() {
    const body = [
      "Grouping",
      this.expression?.toString(),
    ].filter((it) => it).join(" ");
    return "(" + body + ")";
  }
}
export class Literal implements Expr {
  constructor(
    readonly value: null | string | number | boolean,
  ) {}
  accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.visitLiteral(
      this.value,
    );
  }
  toString() {
    const body = [
      "Literal",
      this.value?.toString(),
    ].filter((it) => it).join(" ");
    return "(" + body + ")";
  }
}
export class Logical implements Expr {
  constructor(
    readonly left: Expr,
    readonly operator: Token,
    readonly right: Expr,
  ) {}
  accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.visitLogical(
      this.left,
      this.operator,
      this.right,
    );
  }
  toString() {
    const body = [
      "Logical",
      this.left?.toString(),
      this.operator?.toString(),
      this.right?.toString(),
    ].filter((it) => it).join(" ");
    return "(" + body + ")";
  }
}
export class Set implements Expr {
  constructor(
    readonly object: Expr,
    readonly name: Token,
    readonly value: Expr,
  ) {}
  accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.visitSet(
      this.object,
      this.name,
      this.value,
    );
  }
  toString() {
    const body = [
      "Set",
      this.object?.toString(),
      this.name?.toString(),
      this.value?.toString(),
    ].filter((it) => it).join(" ");
    return "(" + body + ")";
  }
}
export class Super implements Expr {
  constructor(
    readonly keyword: Token,
    readonly method: Token,
  ) {}
  accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.visitSuper(
      this.keyword,
      this.method,
    );
  }
  toString() {
    const body = [
      "Super",
      this.keyword?.toString(),
      this.method?.toString(),
    ].filter((it) => it).join(" ");
    return "(" + body + ")";
  }
}
export class This implements Expr {
  constructor(
    readonly keyword: Token,
  ) {}
  accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.visitThis(
      this.keyword,
    );
  }
  toString() {
    const body = [
      "This",
      this.keyword?.toString(),
    ].filter((it) => it).join(" ");
    return "(" + body + ")";
  }
}
export class Unary implements Expr {
  constructor(
    readonly operator: Token,
    readonly expression: Expr,
  ) {}
  accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.visitUnary(
      this.operator,
      this.expression,
    );
  }
  toString() {
    const body = [
      "Unary",
      this.operator?.toString(),
      this.expression?.toString(),
    ].filter((it) => it).join(" ");
    return "(" + body + ")";
  }
}
export class Variable implements Expr {
  constructor(
    readonly name: Token,
  ) {}
  accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.visitVariable(
      this.name,
    );
  }
  toString() {
    const body = [
      "Variable",
      this.name?.toString(),
    ].filter((it) => it).join(" ");
    return "(" + body + ")";
  }
}
export interface StmtVisitor<R> {
  visitBlock(
    statements: Stmt[],
  ): R;
  visitCallable(
    name: Token,
    params: Token[],
    body: Stmt[],
  ): R;
  visitClass(
    name: Token,
    superclass: Variable | undefined,
    methods: Callable[],
  ): R;
  visitExpression(
    expression: Expr,
  ): R;
  visitIf(
    condition: Expr,
    onTrue: Stmt,
    onFalse: Stmt | undefined,
  ): R;
  visitPrint(
    expression: Expr,
  ): R;
  visitReturn(
    keyword: Token,
    value: Expr | undefined,
  ): R;
  visitVar(
    name: Token,
    initializer: Expr | undefined,
  ): R;
  visitWhile(
    condition: Expr,
    body: Stmt,
  ): R;
}
export interface Stmt {
  accept<R>(visitor: StmtVisitor<R>): R;
}
export class Block implements Stmt {
  constructor(
    readonly statements: Stmt[],
  ) {}
  accept<R>(visitor: StmtVisitor<R>): R {
    return visitor.visitBlock(
      this.statements,
    );
  }
  toString() {
    const body = [
      "Block",
      this.statements?.toString(),
    ].filter((it) => it).join(" ");
    return "(" + body + ")";
  }
}
export class Callable implements Stmt {
  constructor(
    readonly name: Token,
    readonly params: Token[],
    readonly body: Stmt[],
  ) {}
  accept<R>(visitor: StmtVisitor<R>): R {
    return visitor.visitCallable(
      this.name,
      this.params,
      this.body,
    );
  }
  toString() {
    const body = [
      "Callable",
      this.name?.toString(),
      this.params?.toString(),
      this.body?.toString(),
    ].filter((it) => it).join(" ");
    return "(" + body + ")";
  }
}
export class Class implements Stmt {
  constructor(
    readonly name: Token,
    readonly superclass: Variable | undefined,
    readonly methods: Callable[],
  ) {}
  accept<R>(visitor: StmtVisitor<R>): R {
    return visitor.visitClass(
      this.name,
      this.superclass,
      this.methods,
    );
  }
  toString() {
    const body = [
      "Class",
      this.name?.toString(),
      this.superclass?.toString(),
      this.methods?.toString(),
    ].filter((it) => it).join(" ");
    return "(" + body + ")";
  }
}
export class Expression implements Stmt {
  constructor(
    readonly expression: Expr,
  ) {}
  accept<R>(visitor: StmtVisitor<R>): R {
    return visitor.visitExpression(
      this.expression,
    );
  }
  toString() {
    const body = [
      "Expression",
      this.expression?.toString(),
    ].filter((it) => it).join(" ");
    return "(" + body + ")";
  }
}
export class If implements Stmt {
  constructor(
    readonly condition: Expr,
    readonly onTrue: Stmt,
    readonly onFalse: Stmt | undefined,
  ) {}
  accept<R>(visitor: StmtVisitor<R>): R {
    return visitor.visitIf(
      this.condition,
      this.onTrue,
      this.onFalse,
    );
  }
  toString() {
    const body = [
      "If",
      this.condition?.toString(),
      this.onTrue?.toString(),
      this.onFalse?.toString(),
    ].filter((it) => it).join(" ");
    return "(" + body + ")";
  }
}
export class Print implements Stmt {
  constructor(
    readonly expression: Expr,
  ) {}
  accept<R>(visitor: StmtVisitor<R>): R {
    return visitor.visitPrint(
      this.expression,
    );
  }
  toString() {
    const body = [
      "Print",
      this.expression?.toString(),
    ].filter((it) => it).join(" ");
    return "(" + body + ")";
  }
}
export class Return implements Stmt {
  constructor(
    readonly keyword: Token,
    readonly value: Expr | undefined,
  ) {}
  accept<R>(visitor: StmtVisitor<R>): R {
    return visitor.visitReturn(
      this.keyword,
      this.value,
    );
  }
  toString() {
    const body = [
      "Return",
      this.keyword?.toString(),
      this.value?.toString(),
    ].filter((it) => it).join(" ");
    return "(" + body + ")";
  }
}
export class Var implements Stmt {
  constructor(
    readonly name: Token,
    readonly initializer: Expr | undefined,
  ) {}
  accept<R>(visitor: StmtVisitor<R>): R {
    return visitor.visitVar(
      this.name,
      this.initializer,
    );
  }
  toString() {
    const body = [
      "Var",
      this.name?.toString(),
      this.initializer?.toString(),
    ].filter((it) => it).join(" ");
    return "(" + body + ")";
  }
}
export class While implements Stmt {
  constructor(
    readonly condition: Expr,
    readonly body: Stmt,
  ) {}
  accept<R>(visitor: StmtVisitor<R>): R {
    return visitor.visitWhile(
      this.condition,
      this.body,
    );
  }
  toString() {
    const body = [
      "While",
      this.condition?.toString(),
      this.body?.toString(),
    ].filter((it) => it).join(" ");
    return "(" + body + ")";
  }
}
