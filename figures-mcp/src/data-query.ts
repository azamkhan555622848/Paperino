import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// The packaged app passes PAPERINO_JQ. Failing that, resolve the pinned binary RELATIVE to
// this module: an absolute fallback bakes whichever machine built the bundle into the
// shipped artifact. From src/ the binary is ../../tools/jq; from the packaged dist, ../bin/jq.
const HERE = dirname(fileURLToPath(import.meta.url))
const JQ =
  process.env.PAPERINO_JQ ||
  [join(HERE, "..", "..", "tools", "jq", "jq.exe"), join(HERE, "..", "bin", "jq", "jq.exe")].find(existsSync) ||
  "jq"

export function dataQuery(workspace: string, path: string, jqExpr: string): Promise<string> {
  const abs = isAbsolute(path) ? path : resolve(join(workspace, path))
  if (!abs.startsWith(resolve(workspace))) return Promise.reject(new Error(`path must stay inside the workspace: ${path}`))
  if (!existsSync(abs)) return Promise.reject(new Error(`no such file: ${abs}`))
  return new Promise((resolvePromise, reject) => {
    execFile(
      JQ,
      [jqExpr, abs],
      { windowsHide: true, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`jq failed on ${abs}: ${stderr || error.message}`))
        else resolvePromise(stdout.trim())
      },
    )
  })
}
