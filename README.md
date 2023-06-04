# TSLox

Two implementations of lox: the tree walker in src/lox and the byte code
interpreter in src/lox2.

The byte code interpreter omits a garbage collector, because... why bother? V8
already collects garbage for us. Of course, a byte code interpeter in typescript
may be useless anyway. The point was to better understand the structure of clox,
by porting it to a language I am more interested in and familiar with.

## Running

Using Deno on Windows: `deno run .\src\lox2\main.ts .\src\lox2\test.lox`
