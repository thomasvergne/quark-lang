import {Block, Element} from '../typings/block.ts';
import {Parser} from './parser.ts';
import { existsSync } from 'https://deno.land/std/fs/mod.ts';

export class Interpreter {
  private static stack: Record<any, any> = {};
  private static ast: Block;
  private static cwd: string;
  private static process(node: Block | Element, state?: string, index?: number): any | void {
    let returned;
    if ('value' in node) {
      if (state && state === 'Identifier') return node.value as string;
      if (node.type === 'Word') {
        if (this.stack[node.value] !== undefined) return this.stack[node.value];
        return node.value as string;
      }
      return node.value as string;
    }
    for (const child of node) {
      if (Array.isArray(child)) {
        returned = this.process(child);
      } else {
        const [expression, ...args] = node;
        if ('value' in (expression as Element)) {
          const expr = <Element>expression;
          if (['+', '-', '/', '*'].includes(expr.value as string)) {
            if (state === 'Identifier') {
              (<Element[]>args).map((arg) => arg.type = 'Word');
            }
            const parsedArgs = args.map((acc) => {
              if ('value' in acc && acc.type === 'Number') {
                return Number(this.process(acc)) as any;
              }
              return this.process(acc) as any;
            });
            if (parsedArgs.length === 0) return '';
            switch (expr.value) {
              case '+': return parsedArgs.reduce((acc, cur) => acc + cur);
              case '-': return parsedArgs.reduce((acc, cur) => acc - cur);
              case '*': return parsedArgs.reduce((acc, cur) => acc * cur);
              case '/': return parsedArgs.reduce((acc, cur) => acc / cur);
            }
          } else if (expr.value === 'import') {
            return args.map((arg) => {
              let path = this.cwd + '/' +  (<Element>arg).value;
              if (!existsSync(path) && existsSync(path + '.qrk')) path += '.qrk';
              if (Deno.statSync(path).isDirectory) {
                for (const file of Deno.readDirSync(path)) {
                  const filePath = path + '/' + file.name;
                  const array = Deno.readFileSync(filePath);
                  const parsed = Parser.parse(new TextDecoder('utf-8').decode(array));
                  this.process(parsed);
                }
              } else {
                const array = Deno.readFileSync(path);
                const parsed = Parser.parse(new TextDecoder('utf-8').decode(array));
                return this.process(parsed);
              }
            });
          } else if (expr.value === 'let') {
            const id = this.process(args[0] as Block, 'Identifier');
            if (typeof id !== 'string' && 'index' in id) {
              if (typeof this.stack[id.variable] === 'string') {
                if (this.process(args[1]).length > 1) throw 'String index modifiers cannot be longer than 1 char';
                this.stack[id.variable] = this.process(args[1]) + this.stack[id.variable].slice(1);
              }
              else this.stack[id.variable][id.index] = this.process(args[1]);
            }
            else this.stack[id] = this.process(args[1] as Block);
            return this.stack[id];
          } else if (expr.value === 'push') {
            this.process(args[0]).push(...this.process(args.slice(1)));
          } else if (expr.value === 'print') {
            return console.log(...args.map((arg) => this.process(arg)));
          } else if (expr.value === 'close') {
            console.log('Stopped due to', ...args.map((arg) => this.process(arg)) + '.');
            Deno.exit();
          } else if (expr.value === 'if') {
            if (this.process(args[0])) return this.process(args[1]);
            return this.process(args[2] || []);
          } else if (expr.value === 'index') {
            if (state === 'Identifier') return { variable: (<Element>args[0]).value, index: this.process(args[1]) };
            return this.process(args[0])[this.process(args[1])] || 'none';
          } else if (expr.value === '=') {
            return this.process(args[0]) == this.process(args[1]);
          } else if (expr.value === '<') {
            return this.process(args[0]) < this.process(args[1]);
          } else if (expr.value === '!=') {
            return this.process(args[0]) != this.process(args[1]);
          } else if (expr.value === 'while') {
            let res;
            while (this.process(args[0])) {
              res = this.process(args[1]);
            }
            return res;
          } else if (expr.value === 'list') {
            return [...args.map((arg) => this.process(arg))];
          } else if (expr.value === 'fn') {
            const processedArgs = this.process(args[0]);
            return {
              arguments: processedArgs,
              body: args[1] as Block,
              type: 'function',
              callee: {},
            };
          } else if (expr.value === 'return') {
            return this.process(args[0]);
          } else if (this.process(expr) && (<Record<any, any>>this.process(expr)).type === 'function') {
            const fn: Record<any, any> = this.process(expr) as Record<any, any>;
            for (const index in args) this.stack[fn.arguments[index]] = this.process(args[index]);
            return this.process(fn.body);
          } else if (['Word', 'String', 'Number'].includes(expr.type)) {
            return [this.process(expr), ...args.map((arg) => this.process(arg))];
          }
          return node;
        }
      }
    }
    if (returned) return returned;
    return 'none';
  }
  public static run(source: string, cwd?: string) {
    this.ast = Parser.parse(source);
    this.cwd = cwd || Deno.cwd();
    this.process(this.ast);
    return undefined;
  }
}