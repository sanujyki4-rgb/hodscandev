// solc ships no official TypeScript types. We only use a tiny surface:
// the default export's compile() and the async loadRemoteVersion() loader.
declare module "solc" {
  interface SolcCompiler {
    compile(input: string): string;
  }
  interface Solc {
    compile(input: string): string;
    loadRemoteVersion(
      version: string,
      callback: (err: Error | null, solcSnapshot: SolcCompiler) => void
    ): void;
  }
  const solc: Solc;
  export default solc;
}
