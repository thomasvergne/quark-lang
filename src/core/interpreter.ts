import type { Block, Element } from '../typings/block.ts';
import { Parser } from './parser.ts';
import { existsSync } from 'https://deno.land/std/fs/mod.ts';
import * as path from 'https://deno.land/std@0.83.0/path/mod.ts';

export class Interpreter {
  private static _stack: Record<any, any>[] = [];
  private static ast: Block;
  private static cwd: string;
  private static folder: string;
  private static get stack() {
    if (this._stack.length === 0) this.pushStackFrame();
    return this._stack.slice(-1)[0];
  }

  private static pushStackFrame() {
    let variables = {};
    for (const stack of this._stack) variables = { ...variables, ...stack };
    this._stack.push(variables);
    return this.stack;
  }

  private static popStackFrame() {
    this._stack.pop();
    return this.stack;
  }

  private static async variableDefinition(node: Block) {
    const variable = await this.process(<Element>node[0], 'Identifier');
    const value = await this.process(<Element>node[1]);
    if (typeof variable !== 'string' && 'variable' in variable) {
      const currentStackVariable = this.stack[variable.variable];
      if (typeof currentStackVariable === 'string') {
        const splitUpdate = currentStackVariable.split('');
        splitUpdate[variable.index] = value;
        this.stack[variable.variable] = splitUpdate.join('');
      }
      else currentStackVariable[variable.index] = value;
    }
    else this.stack[await this.process(<Element>node[0], 'Identifier')] = value;
  }

  private static processValue(element: Element, state?: string) {
    if (element.value === 'none') return undefined;
    if (element.value === 'stack') return this.stack;
    if (element.type === 'Word') {
      if (state && state === 'Identifier') return element.value;
      if (this.stack[element.value] !== undefined) return this.stack[element.value];
      return 'none';
    }
    return element.value as string;
  }

  private static async processArithmetic(operation: string, args: Block): Promise<any> {
    switch (operation) {
      case '+': // @ts-ignore
        return args.reduce(async (acc: any, cur: any) => (await this.process(acc)) + (await this.process(cur)));
      case '-': // @ts-ignore
        return args.reduce(async (acc: any, cur: any) => (await this.process(acc)) - (await this.process(cur)));
      case '*':
        // @ts-ignore
        return args.reduce(async (acc: any, cur: any) => (await this.process(acc)) * (await this.process(cur)));
      case '/':
        // @ts-ignore
        return args.reduce(async (acc: any, cur: any) => (await this.process(acc)) / (await this.process(cur)));
    }
  }

  private static async processList(args: Block): Promise<any> {
    const array = [];
    for (const arg of args) array.push(await this.process(arg));
    return array;
  }

  private static async functionDefinition(node: Block) {
    const [args, body] = node;
    const functionArguments: string[] = [];
    // @ts-ignore
    for (const arg of args) {
      const argumentName: string = await this.processValue(<Element>arg, 'Identifier');
      functionArguments.push(argumentName);
    }
    return {
      args: functionArguments,
      body,
      type: 'Function'
    };
  }

  private static async callFunction(node: Block, functionName: string) {
    const values = [];
    for (const arg of node) values.push(await this.process(arg));
    if (this.stack[functionName].js === true) return this.stack[functionName].func(...values);
    this.pushStackFrame();
    const fn = this.stack[functionName]
    for (const index in fn.args) this.stack[fn.args[index]] = values[Number(index)];
    for (const el of fn.body) {
      const res = await this.process(el);
      if (res && res[1] && res[1] === true) {
        for (const arg of fn.args) delete this.stack[arg];
        return res[0];
      }
    }
    const lastStatement = fn.body.slice(-1)[0];
    for (const arg of fn.args) delete this.stack[arg];
    if (lastStatement && lastStatement.length > 1 && lastStatement[0].value !== 'return') return 'none';
    if (lastStatement) return await this.process(lastStatement);
    this.popStackFrame();
    return 'none';
  }

  private static async processReturn(node: Block) {
    const value = await this.process(node[0]);
    this.popStackFrame();
    return [value, true];
  }

  private static async processCondition(node: Block) {
    if (await this.process(node[0])) return this.process(node[1]);
    if (node[2]) return this.process(node[2]);
    return [undefined, false]
  }

  private static async processEqualities(operation: string, lhs: Block | Element, rhs: Block | Element) {
    switch (operation) {
      case '=': return await this.process(lhs) == await this.process(rhs);
      case '!=': return await this.process(lhs) != await this.process(rhs);
      case '<': return await this.process(lhs) < await this.process(rhs);
      case '>': return await this.process(lhs) > await this.process(rhs);
      case '<=': return await this.process(lhs) <= await this.process(rhs);
      case '>=': return await this.process(lhs) >= await this.process(rhs);
      case 'and': return await this.process(lhs) && await this.process(rhs);
      case 'or': return await this.process(lhs) || await this.process(rhs);
    }
  }

  private static async processImport(node: Block, cwd: string) {
    let src: string = ((<Element>node[0]).value as string).replace(/:/g, '/');
    if (!existsSync(path.join(cwd, this.folder, src))) {
      // Checking if core library
      if (!existsSync(cwd + src)) src = path.join(cwd, 'libs', src);
      else src = path.join(cwd, src);
      if (!existsSync(src)) throw `File ${src} does not exists!`;
    } else src = path.join(cwd, this.folder, src);
    src = path.toFileUrl(src.replace(/\\/g, '/')).href;
    if (!src.endsWith('.js')) {
      const array = Deno.readFileSync(src);
      const content: string = new TextDecoder('utf-8').decode(array);

      const ast = Parser.parse(content, true);
      const splitPath = src.split('/');
      await this.process(ast, undefined, splitPath.slice(0, splitPath.length - 1).join('/') + '/');
    } else {
      const { module, namespace } = await import(src);
      if (Array.isArray(module)) {
        for (const func of module) {
          this.stack[namespace ? namespace + ':' + func.name : func.name] = {
            type: 'Function',
            js: true,
            func: func.func,
          };
        }
      } else this.stack[namespace ? namespace + ':' + module.name : module.name] = {
        type: 'Function',
        js: true,
        func: module.func,
      };
    }
  }

  private static async processWhile(node: Block) {
    const [condition, body] = node;
    while (await this.process(condition)) {
      await this.process(body);
    }
  }

  private static async processListIndex(node: Block, state?: string) {
    const [array, index] = node;
    if (state && state === 'Identifier') {
      return {
        variable: this.process(array, 'Identifier'),
        index: this.process(index),
      };
    }
    return (await this.process(array))[await this.process(index)];
  }

  private static async process(node: Block | Element, state?: string, cwd: string = this.cwd): Promise<any> {
    let returned;
    if (typeof node === 'string') return node;
    if ('value' in node) return Interpreter.processValue(node, state);
    for (const child of node) {
      if (Array.isArray(child)) {
        returned = await this.process(child, undefined, cwd);
      } else {
        const [expression, ...args] = node;
        if ('value' in (expression as Element)) {
          const expr = <Element>expression;
          if (expr.value === '{') {
            this.pushStackFrame();
            await this.process(args, undefined, cwd);
            this.popStackFrame();
          }
          else if (expr.value === 'import') return await Interpreter.processImport(args, cwd);
          else if (expr.value === 'let') return await this.variableDefinition(args);
          else if (['+', '-', '/', '*'].includes(expr.value as string)) return await Interpreter.processArithmetic(expr.value as string, args);
          else if (expr.value === 'fn') return await Interpreter.functionDefinition(args);
          else if (expr.value === 'return') return await Interpreter.processReturn(args);
          else if (['=', '!=', '<', '>', '<=', '>=', 'and', 'or'].includes(expr.value as string)) return await Interpreter.processEqualities(expr.value as string, args[0], args[1]);
          else if (expr.value === 'if') return await Interpreter.processCondition(args);
          else if (expr.value === 'list') return await Interpreter.processList(args);
          else if (expr.value === 'while') return await Interpreter.processWhile(args);
          else if (expr.value === 'index') return await Interpreter.processListIndex(args, state);
          else if (Interpreter.stack[expr.value] && Interpreter.stack[expr.value].type === 'Function') return await Interpreter.callFunction(args, expr.value as string);
          throw `Function or keyword ${expr.value} does not exists!`;
        }
      }
    }
    if (returned) {
      return returned;
    }
    return 'none';
  }
  public static async run(source: string, cwd?: string, folder?: string) {
    this.ast = Parser.parse(source);
    this.folder = folder + '';
    this.cwd = cwd || Deno.cwd();
    await this.process(this.ast);
    return undefined;
  }
}