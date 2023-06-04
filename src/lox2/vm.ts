import {
  BoundMethod,
  Closure,
  Instance,
  LoxClass,
  LoxFunction,
  LoxString,
  Native,
  NativeFn,
  Obj,
  OpCode,
  Pool,
  printValue,
  Table,
  Upvalue,
  Value,
  valueType,
} from "./chunk.ts";
import { compile } from "./compiler.ts";

type CallFrame = {
  closure: Closure;
  ip: number;
  offset: number;
};

export class VM {
  frames: CallFrame[] = [];
  stack: Value[] = [];
  globals: Table = new Table();
  initString: LoxString;
  openUpvalues: Upvalue | null = null;
  constructor(readonly pool: Pool) {
    this.defineNative("clock", (_: number) => Date.now() / 1000);
    this.initString = this.pool.intern("init");
  }

  resetStack() {
    this.stack.length = 0;
    this.frames.length = 0;
    this.openUpvalues = null;
  }
  runtimeError(message: string) {
    console.error(message);
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const frame = this.frames[i];
      const func = frame.closure.func;
      let log = `[line ${func.chunk.lines[frame.ip]}] in `;
      if (func.name === null) log += "script";
      else log += `${(func.name as LoxString).chars}()`;
      console.error(log);
    }
    this.resetStack();
  }

  defineNative(name: string, f: NativeFn) {
    this.globals.set(this.pool.intern(name), new Native(f));
  }

  peek(distance: number) {
    // note: what if the distance gets too big?
    return this.stack[this.stack.length - 1 - distance];
  }

  put(distance: number, value: Value) {
    return (this.stack[this.stack.length - 1 - distance] = value);
  }

  call(closure: Closure, argCount: number) {
    if (argCount !== closure.func.arity) {
      this.runtimeError(
        `Expected ${closure.func.arity} arguments but got ${argCount}.`,
      );
      return false;
    }
    if (this.frames.length === 64) {
      this.runtimeError("Stack overflow.");
      return false;
    }
    this.frames.push({
      closure,
      ip: 0,
      offset: this.stack.length - argCount - 1,
    });
    return true;
  }

  callValue(callee: Value, argCount: number) {
    if (callee instanceof Obj) {
      switch (callee.constructor) {
        case BoundMethod: {
          const bound = callee as BoundMethod;
          this.put(argCount, bound.receiver);
          return this.call(bound.method, argCount);
        }
        case LoxClass: {
          const klass = callee as LoxClass;
          this.put(argCount, new Instance(klass));
          const initializer = klass.methods.get(this.initString);
          if (initializer) return this.call(initializer as Closure, argCount);
          else if (argCount !== 0) {
            this.runtimeError(`Expected 0 arguments but got ${argCount}.`);
            return false;
          }
          return true;
        }
        case Closure:
          return this.call(callee as Closure, argCount);
        case Native: {
          const native = callee as Native;
          const result = native.nativeFn(
            argCount,
            this.stack.slice(this.stack.length - argCount),
          );
          this.stack.length -= argCount;
          this.stack.push(result);
          return true;
        }
        default:
          break; // Non-callable object type.
      }
    }
    this.runtimeError("Can only call functions and classes.");
    return false;
  }

  invokeFromClass(klass: LoxClass, name: LoxString, argCount: number): boolean {
    const method = klass.methods.get(name);
    if (!method) {
      this.runtimeError(`Undefined property '${name.chars}'.`);
      return false;
    }
    return this.call(method as Closure, argCount);
  }

  invoke(name: LoxString, argCount: number): boolean {
    const receiver = this.peek(argCount);
    if (!(receiver instanceof Instance)) {
      this.runtimeError("Only instances have methods.");
      return false;
    }

    const instance = receiver;

    const value = instance.fields.get(name);
    if (value) {
      this.put(argCount, value);
      return this.callValue(value, argCount);
    }

    return this.invokeFromClass(instance.klass, name, argCount);
  }

  bindMethod(klass: LoxClass, name: LoxString): boolean {
    const method = klass.methods.get(name);
    if (!method) {
      this.runtimeError(`Undefined property '${name.chars}'.`);
      return false;
    }
    this.stack.push(
      new BoundMethod(this.stack.pop() as Value, method as Closure),
    );
    return true;
  }

  captureUpvalue(index: number): Upvalue {
    let prevUpvalue: Upvalue | null = null;
    let upvalue = this.openUpvalues;
    while (upvalue !== null && upvalue.index > index) {
      prevUpvalue = upvalue;
      upvalue = upvalue.next;
    }

    if (upvalue !== null && upvalue.index === index) return upvalue;

    const createdUpvalue = new Upvalue(index);

    createdUpvalue.next = upvalue;

    if (prevUpvalue === null) this.openUpvalues = createdUpvalue;
    else prevUpvalue.next = createdUpvalue;

    return createdUpvalue;
  }

  closeUpvalues(last: number) {
    while (this.openUpvalues !== null && this.openUpvalues.index >= last) {
      const upvalue: Upvalue = this.openUpvalues;
      upvalue.closed = this.stack[upvalue.index];
      upvalue.index = -1;
      this.openUpvalues = upvalue.next;
    }
  }

  defineMethod(name: LoxString) {
    const method = this.peek(0);
    const klass = this.peek(1) as LoxClass;
    klass.methods.set(name, method);
    this.stack.pop();
  }

  isFalsey(value: Value): boolean {
    return value === null || value === false;
  }

  concatenate() {
    const b = this.stack.pop() as LoxString;
    const a = this.stack.pop() as LoxString;
    this.stack.push(this.pool.intern(a.chars + b.chars));
  }

  binaryOp(op: (a: number, b: number) => Value) {
    const b = this.stack.pop();
    const a = this.stack.pop();
    if (typeof b !== "number" || typeof a !== "number") {
      this.runtimeError("Operands must be numbers.");
      return InterpretResult.RUNTIME_ERROR;
    }
    this.stack.push(op(a, b));
  }

  run(): InterpretResult {
    let frame = this.frames[this.frames.length - 1];
    function readByte(): number {
      return frame.closure.func.chunk.code[frame.ip++];
    }
    function readShort(): number {
      return (readByte() << 8) | readByte();
    }
    function readConstant(): Value {
      return frame.closure.func.chunk.constants[readByte()];
    }
    function readString() {
      return readConstant() as LoxString;
    }

    for (;;) {
      switch (readByte()) {
        case OpCode.CONSTANT: {
          this.stack.push(readConstant());
          break;
        }
        case OpCode.NIL:
          this.stack.push(null);
          break;
        case OpCode.TRUE:
          this.stack.push(true);
          break;
        case OpCode.FALSE:
          this.stack.push(false);
          break;
        case OpCode.POP:
          this.stack.pop();
          break;
        case OpCode.GET_LOCAL: {
          const slot = readByte();
          this.stack.push(this.stack[frame.offset + slot]);
          break;
        }
        case OpCode.GET_GLOBAL: {
          const name = readString();
          const value = this.globals.get(name);
          if (value === undefined) {
            this.runtimeError(`Undefined global '${name.chars}'.`);
            return InterpretResult.RUNTIME_ERROR;
          }
          this.stack.push(value);
          break;
        }
        case OpCode.DEFINE_GLOBAL: {
          this.globals.set(readString(), this.stack.pop() as Value);
          break;
        }
        case OpCode.SET_LOCAL: {
          this.stack[frame.offset + readByte()] = this.peek(0);
          break;
        }
        case OpCode.SET_GLOBAL: {
          const name = readString();
          // tableSet is true if the key is new
          if (this.globals.set(name, this.peek(0))) {
            this.globals.delete(name);
            this.runtimeError(`Undefined global '${name.chars}'.`);
            return InterpretResult.RUNTIME_ERROR;
          }
          break;
        }
        case OpCode.GET_UPVALUE: {
          const slot = readByte();
          const index = frame.closure.upvalues[slot].index;
          this.stack.push(
            index < 0 ? frame.closure.upvalues[slot].closed : this.stack[index],
          );
          break;
        }
        case OpCode.SET_UPVALUE: {
          const slot = readByte();
          const index = frame.closure.upvalues[slot].index;
          if (index < 0) frame.closure.upvalues[slot].closed = this.peek(0);
          else this.stack[index] = this.peek(0);
          break;
        }
        case OpCode.GET_PROPERTY: {
          const instance = this.peek(0);
          if (!(instance instanceof Instance)) {
            this.runtimeError("Only instances have properties.");
            return InterpretResult.RUNTIME_ERROR;
          }
          const name = readString();

          const value = instance.fields.get(name);
          if (value) {
            this.stack.pop(); // Instance.
            this.stack.push(value);
            break;
          }

          if (!this.bindMethod(instance.klass, name)) {
            return InterpretResult.RUNTIME_ERROR;
          }
          break;
        }
        case OpCode.SET_PROPERTY: {
          const instance = this.peek(1);
          if (!(instance instanceof Instance)) {
            this.runtimeError("Only instances have fields.");
            return InterpretResult.RUNTIME_ERROR;
          }
          instance.fields.set(readString(), this.peek(0));
          const value = this.stack.pop() as Value;
          this.stack.pop();
          this.stack.push(value);
          break;
        }
        case OpCode.GET_SUPER: {
          const name = readString();
          const superclass = this.stack.pop() as LoxClass;

          if (!this.bindMethod(superclass, name)) {
            return InterpretResult.RUNTIME_ERROR;
          }
          break;
        }
        case OpCode.EQUAL: {
          const b = this.stack.pop();
          const a = this.stack.pop();
          this.stack.push(a === b);
          break;
        }
        case OpCode.GREATER:
          this.binaryOp((a, b) => a > b);
          break;
        case OpCode.LESS:
          this.binaryOp((a, b) => a < b);
          break;
        case OpCode.ADD: {
          if (
            this.peek(0) instanceof LoxString &&
            this.peek(1) instanceof LoxString
          ) {
            this.concatenate();
          } else if (
            typeof this.peek(0) === "number" &&
            typeof this.peek(1) === "number"
          ) {
            const b = this.stack.pop() as number;
            const a = this.stack.pop() as number;
            this.stack.push(a + b);
          } else {
            this.runtimeError(
              `Operands must be two numbers or two strings, where ${
                valueType(
                  this.peek(1),
                )
              } and ${valueType(this.peek(0))}`,
            );
            return InterpretResult.RUNTIME_ERROR;
          }
          break;
        }
        case OpCode.SUBTRACT:
          this.binaryOp((a, b) => a - b);
          break;
        case OpCode.MULTIPLY:
          this.binaryOp((a, b) => a * b);
          break;
        case OpCode.DIVIDE:
          this.binaryOp((a, b) => a / b);
          break;
        case OpCode.NOT:
          this.stack.push(this.isFalsey(this.stack.pop() as Value));
          break;
        case OpCode.NEGATE:
          if (typeof this.peek(0) !== "number") {
            this.runtimeError("Operand must be a number.");
            return InterpretResult.RUNTIME_ERROR;
          }
          this.stack.push(-(this.stack.pop() as number));
          break;
        case OpCode.PRINT: {
          printValue(this.stack.pop() as Value);
          break;
        }
        case OpCode.JUMP: {
          const offset = readShort();
          frame.ip += offset;
          break;
        }
        case OpCode.JUMP_IF_FALSE: {
          const offset = readShort();
          if (this.isFalsey(this.peek(0))) {
            frame.ip += offset;
          }
          break;
        }
        case OpCode.LOOP: {
          const offset = readShort();
          frame.ip -= offset;
          break;
        }
        case OpCode.CALL: {
          const argCount = readByte();
          if (!this.callValue(this.peek(argCount), argCount)) {
            return InterpretResult.RUNTIME_ERROR;
          }
          frame = this.frames[this.frames.length - 1];
          break;
        }
        case OpCode.INVOKE: {
          const method = readString();
          const argCount = readByte();
          if (!this.invoke(method, argCount)) {
            return InterpretResult.RUNTIME_ERROR;
          }
          frame = this.frames[this.frames.length - 1];
          break;
        }
        case OpCode.SUPER_INVOKE: {
          const method = readString();
          const argCount = readByte();
          const superclass = this.stack.pop() as LoxClass;
          if (!this.invokeFromClass(superclass, method, argCount)) {
            return InterpretResult.RUNTIME_ERROR;
          }
          frame = this.frames[this.frames.length - 1];
          break;
        }
        case OpCode.CLOSURE: {
          const func = readConstant() as LoxFunction;
          const closure = new Closure(func);
          this.stack.push(closure);
          for (let i = 0; i < func.upvalueCount; i++) {
            const isLocal = readByte();
            const index = readByte();
            if (isLocal) {
              closure.upvalues[i] = this.captureUpvalue(frame.offset + index);
            } else closure.upvalues[i] = frame.closure.upvalues[index];
          }
          break;
        }
        case OpCode.CLOSE_UPVALUE:
          this.closeUpvalues(this.stack.length - 1);
          this.stack.pop();
          break;
        case OpCode.RETURN: {
          const result = this.stack.pop() as Value;
          this.closeUpvalues(frame.offset);
          this.frames.length--;
          if (this.frames.length === 0) {
            this.stack.pop();
            return InterpretResult.OK;
          }

          this.stack.length = frame.offset;
          this.stack.push(result);
          frame = this.frames[this.frames.length - 1];
          break;
        }
        case OpCode.CLASS:
          this.stack.push(new LoxClass(readString()));
          break;
        case OpCode.INHERIT: {
          const superclass = this.peek(1);

          if (!(superclass instanceof LoxClass)) {
            this.runtimeError("Superclass must be a class.");
            return InterpretResult.RUNTIME_ERROR;
          }

          const subclass = this.peek(0) as LoxClass;
          subclass.methods.addAll(superclass.methods);
          this.stack.pop(); // Subclass.
          break;
        }
        case OpCode.METHOD:
          this.defineMethod(readString());
          break;
      }
    }
  }

  interpret(source: string): InterpretResult {
    const func = compile(source, this.pool);
    if (func === null) return InterpretResult.COMPILE_ERROR;

    const closure = new Closure(func);
    this.stack.push(closure);
    this.call(closure, 0);
    return this.run();
  }
}

export enum InterpretResult {
  OK,
  COMPILE_ERROR,
  RUNTIME_ERROR,
}
