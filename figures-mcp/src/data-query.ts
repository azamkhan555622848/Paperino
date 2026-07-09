import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"

const JQ = process.env.PAPERINO_JQ || "C:\\Users\\azamk\\Documents\\Paperino\\tools\\jq\\jq.exe"

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
