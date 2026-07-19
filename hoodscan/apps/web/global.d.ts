// Ambient module declarations for asset imports that don't have their
// own type declarations (e.g. CSS side-effect imports like
// `import "./globals.css"`). Next.js handles these correctly at
// runtime — this file only satisfies the type checker.
//
// Needed because TypeScript 6.0 turned on `noUncheckedSideEffectImports`
// by default, which flags side-effect imports with no matching ambient
// declaration (TS2882). This keeps the import valid regardless of
// which TypeScript version an editor happens to be using.
declare module "*.css";

// Minimal EIP-1193 provider typing for MetaMask / injected wallets,
// used by the Write Contract feature (window.ethereum).
interface EthereumProvider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
}

interface Window {
  ethereum?: EthereumProvider;
}
