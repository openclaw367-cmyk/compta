import * as fs from 'node:fs';
import { importEsm } from './esm-interop';

/**
 * Works around a genuine, verified upstream bug in `libxml2-wasm`'s
 * Node file-input provider (`libxml2-wasm/lib/nodejs.mjs`,
 * `xmlRegisterFsInputProviders()`), hit while validating a Factur-X
 * EN16931 invoice's XSD (which `<xs:import>`s three auxiliary schema
 * files) on this Windows dev machine — see
 * specs/invoicing-factur-x-implementation-spec.md for the full
 * root-cause writeup.
 *
 * The bug: that provider's internal `filePath()` helper calls
 * `new URL(filename)` on whatever path string libxml2 asks it to
 * resolve. A bare Windows absolute path like
 * `"C:/Users/.../schema.xsd"` is NOT rejected by `new URL()` — the
 * WHATWG URL grammar accepts any single ASCII letter followed by `:`
 * as a valid scheme, so `new URL("C:/Users/...")` parses successfully
 * with `protocol === "c:"`. Since `filePath()` only proceeds for
 * `protocol === "file:"`, it silently returns `null` for every bare
 * Windows path — `fileExists()` then reports `false` for a file that
 * genuinely exists on disk, and libxml2 reports
 * `"No such file or directory"` even though `fs.existsSync()` on that
 * exact same string returns `true`. Confirmed directly: registering a
 * throwaway provider that just logs the filenames libxml2 asks for
 * shows it requesting the exact, correct, existing absolute path each
 * time — the file is never missing, only mis-detected.
 *
 * The fix: register an ADDITIONAL input provider (libxml2-wasm's own
 * `xmlRegisterInputProvider` supports multiple; the most-recently-
 * registered is tried first — confirmed live, not assumed) that
 * matches a filename via a PLAIN `fs.existsSync()` check, never
 * `new URL()`. This purely ADDS coverage for the case the built-in
 * provider mishandles — file:// URLs and POSIX paths still work
 * exactly as before, via the original provider underneath.
 */

let registered = false;

export async function registerWindowsXsdImportFix(): Promise<void> {
  if (registered || process.platform !== 'win32') {
    return;
  }
  const { xmlRegisterInputProvider } =
    await importEsm<typeof import('libxml2-wasm')>('libxml2-wasm');

  xmlRegisterInputProvider({
    match(filename: string): boolean {
      try {
        return fs.existsSync(filename);
      } catch {
        return false;
      }
    },
    open(filename: string): number | undefined {
      try {
        return fs.openSync(filename, 'r');
      } catch {
        return undefined;
      }
    },
    read(fd: number, buf: Uint8Array): number {
      try {
        return fs.readSync(fd, buf, 0, buf.byteLength, null);
      } catch {
        return -1;
      }
    },
    close(fd: number): boolean {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore, matching libxml2-wasm's own provider's own behavior
      }
      return true;
    },
  });
  registered = true;
}
