declare module "node:fs/promises" {
  export function writeFile(path: string, data: string | Uint8Array): Promise<void>;
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function unlink(path: string): Promise<void>;
}

declare module "node:path" {
  export function join(...paths: string[]): string;
  export function dirname(path: string): string;
}
