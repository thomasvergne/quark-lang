import { Block, Element } from '../typings/block';
import * as path from 'path';

export function isContainer(element: Block | Element): boolean {
  return Array.isArray(element) && element.every((child) => Array.isArray(child));
}

export function isValue(element: Block | Element): boolean {
  return element && ('value' in element || 'body' in element) && 'type' in element;
}

export function isObject(element: any): boolean {
  return !Array.isArray(element) && typeof element === 'object';
}

export function parentDir(src: string, it: number = 1): string {
  for (let i = 0; i < it; i++) src = path.dirname(src);
  return src;
}