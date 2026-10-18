// Commands for betterncm.app.exec (docs/CLIENT.md, "BetterNCM 的文件接口"). BetterNCM splits the command with
// CommandLineToArgvW, starts the first item as the program and joins the rest back with spaces, their quotes gone
// (ShellExecuteExW, the window hidden unless asked). A path given in plain quotes then reaches the program in pieces
// wherever it has a space: `cmd /c rmdir /s /q "D:\a b\x"` removes D:\a.
//
// The program itself goes in plain quotes: CommandLineToArgvW reads the first item up to the next quote, as it is.

/**
 * A path as an argument: its quotes escaped, so that the program still gets them. A trailing backslash is dropped
 * (it would escape the closing quote).
 */
export const execArg = (path: string) => `"\\"${path.replace(/\\+$/, '')}\\""`;
