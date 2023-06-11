export enum OpCode {
  CONSTANT,
  NIL,
  TRUE,
  FALSE,
  POP,
  GET_LOCAL,
  GET_GLOBAL,
  DEFINE_GLOBAL,
  SET_LOCAL,
  SET_GLOBAL,
  GET_UPVALUE,
  SET_UPVALUE,
  GET_PROPERTY,
  SET_PROPERTY,
  GET_SUPER,
  EQUAL,
  GREATER,
  LESS,
  ADD,
  SUBTRACT,
  MULTIPLY,
  DIVIDE,
  NOT,
  NEGATE,
  PRINT,
  JUMP,
  JUMP_IF_FALSE,
  LOOP,
  CALL,
  INVOKE,
  SUPER_INVOKE,
  CLOSURE,
  CLOSE_UPVALUE,
  RETURN,
  CLASS,
  INHERIT,
  METHOD,
}

export class Chunk {
  code: number[] = [];
  lines: number[] = [];
  constants: Value[] = [];
  get count() {
    return this.code.length;
  }
  write(byte: number, line: number) {
    this.code.push(byte);
    this.lines.push(line);
  }
  addConstant(value: Value): number {
    return this.constants.push(value) - 1;
  }
}

export abstract class Obj {
  abstract print(): void;
}

export class LoxFunction extends Obj {
  arity = 0;
  upvalueCount = 0;
  chunk: Chunk = new Chunk();
  name: LoxString | null = null;
  constructor() {
    super();
  }
  print(): void {
    console.log(this.name ? `<fn ${this.name.chars}>` : "<script>");
  }
}

export type NativeFn = (arity: number, args: Value[]) => Value;
export class Native extends Obj {
  constructor(readonly nativeFn: NativeFn) {
    super();
  }
  print(): void {
    console.log("<native fn>");
  }
}

export class LoxString extends Obj {
  constructor(readonly chars: string, readonly hash: number) {
    super();
  }
  toString() {
    return this.chars;
  }
  print(): void {
    console.log(this.toString());
  }
}

export class Pool {
  strings = new Table();

  intern(name: string) {
    const hash = hashString(name);
    let key = this.strings.findString(name, hash);
    if (key === undefined) {
      key = new LoxString(name, hash);
      this.strings.set(key, null);
    }
    return key;
  }
}

export class Upvalue extends Obj {
  next: Upvalue | null = null;
  closed: Value = null;
  constructor(public index: number) {
    super();
  }
  print(): void {
    console.log("upvalue");
  }
}

export class Closure extends Obj {
  upvalues: Upvalue[] = [];
  constructor(public func: LoxFunction) {
    super();
  }
  print(): void {
    this.func.print();
  }
}

export class LoxClass extends Obj {
  methods: Table = new Table();
  constructor(public name: LoxString) {
    super();
  }
  print(): void {
    this.name.print();
  }
}

export class Instance extends Obj {
  readonly fields: Table = new Table();
  constructor(readonly klass: LoxClass) {
    super();
  }
  print(): void {
    console.log(`${this.klass.name.chars} instance`);
  }
}

export class BoundMethod extends Obj {
  constructor(public receiver: Value, public method: Closure) {
    super();
  }
  print(): void {
    this.method.func.print();
  }
}

export type Value = null | boolean | number | Obj;

export function valueType(value: Value) {
  switch (typeof value) {
    case "object":
      return value ? "object" : "nil";
    case "boolean":
      return "boolean";
    case "number":
      return "number";
  }
}

export function printValue(x: Value) {
  if (x === null) console.log("nil");
  else if (x instanceof Obj) x.print();
  else console.log("" + x);
}

export function hashString(key: string) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash *= 16777619;
  }
  return hash | 0;
}

const MAX_LOAD = 0.75;

export class Table {
  private count = 0;
  private capacity = 0;
  private keys: LoxString[] = [];
  private values: Value[] = [];

  static #find(
    keys: LoxString[],
    values: Value[],
    mask: number,
    key: LoxString
  ): number {
    let tombstone: number | undefined = undefined;
    let index = key.hash & mask;
    for (;;) {
      const key2 = keys[index];
      const value = values[index];
      if (key2 === undefined) {
        if (value === undefined) {
          return tombstone === undefined ? index : tombstone;
        } else tombstone = index;
      } else if (key === key2) return index;
      index = (index + 1) & mask;
    }
  }

  #grow(capacity: number) {
    this.count = 0;
    const keys = new Array<LoxString>(capacity);
    const values = new Array<Value>(capacity);
    if (this.keys === null || this.values === null) {
      this.keys = keys;
      this.values = values;
      return;
    }
    const mask = capacity - 1;
    for (let i = 0; i < this.capacity; i++) {
      const key: LoxString | undefined = this.keys[i];
      if (key === undefined) continue;
      const index = Table.#find(keys, values, mask, key);
      keys[index] = key;
      values[index] = this.values[i];
      this.count++;
    }
    this.keys = keys;
    this.values = values;
    this.capacity = capacity;
  }

  findString(chars: string, hash: number): LoxString | undefined {
    if (this.count === 0) return undefined;
    let index = hash & (this.capacity - 1);
    for (let i = 0; i < this.capacity; i++) {
      const key = this.keys[index];
      if (key === undefined) {
        if (this.values[index] === undefined) return undefined;
      } else if (key.hash === hash && key.chars === chars) {
        return key;
      }
      index = (index + 1) & (this.capacity - 1);
    }
    console.log(this.keys, this.values);
    throw new Error("wtf!?");
  }

  get(key: LoxString): Value | undefined {
    if (this.count === 0) return undefined;
    const index = Table.#find(this.keys, this.values, this.capacity - 1, key);
    if (this.keys[index] === undefined) return undefined;
    return this.values[index];
  }

  set(key: LoxString, value: Value): boolean {
    if (this.count + 1 > this.capacity * MAX_LOAD) {
      this.#grow(this.capacity < 8 ? 8 : this.capacity * 2);
    }
    const index = Table.#find(this.keys, this.values, this.capacity - 1, key);
    const isNewKey = this.keys[index] === undefined;
    if (isNewKey) {
      this.keys[index] = key;
      if (this.values[index] === undefined) this.count++;
    }
    this.values[index] = value;
    return isNewKey;
  }

  delete(key: LoxString): boolean {
    if (this.count === 0) return false;
    const index = Table.#find(this.keys, this.values, this.capacity - 1, key);
    if (this.keys[index] === undefined) return false;
    delete this.keys[index];
    return true;
  }

  *entries(): Generator<[LoxString, Value]> {
    for (let i = 0; i < this.capacity; i++) {
      const key = this.keys[i];
      if (key === undefined) continue;
      yield [key, this.values[i]];
    }
  }

  addAll(other: Table) {
    for (const [key, value] of other.entries()) this.set(key, value);
  }
}
