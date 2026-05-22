import { ParsedFile } from './types';

export interface MevneAhidParser {
  readonly format: 'XML' | 'FIXED_WIDTH';
  parse(content: Buffer, parserVersion: string): ParsedFile;
}
