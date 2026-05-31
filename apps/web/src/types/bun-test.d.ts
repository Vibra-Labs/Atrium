declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => unknown | Promise<unknown>): void;
  export function expect(actual: unknown): any;
}
