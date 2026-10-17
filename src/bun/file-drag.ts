import { dlopen, FFIType } from "bun:ffi";

export function fileDragBridge(path: string): (files: string[], title: string, startedAt: number) => void {
  const library = dlopen(path, {
    ff_install_file_drag: { args: [], returns: FFIType.void },
    ff_arm_file_drag: { args: [FFIType.cstring], returns: FFIType.void },
  });
  library.symbols.ff_install_file_drag();
  // dlopen's library and native drag source remain alive for the app lifetime.
  return (files, title, startedAt) => library.symbols.ff_arm_file_drag(Buffer.from(`${JSON.stringify({ files, title, startedAt })}\0`));
}
