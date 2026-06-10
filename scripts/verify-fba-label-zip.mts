import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import JSZip from "jszip";
import {
  buildCombinedFbaLabelZip,
  COMBINED_FBA_LABEL_ZIP_FILE_NAME,
  parseFbaLabelPdf,
} from "../src/lib/scm-dashboard/fbaLabelZip.ts";

const [, , outDir = "./tmp-fba-zips", ...inputPaths] = process.argv;
if (inputPaths.length === 0) {
  throw new Error("Usage: node scripts/verify-fba-label-zip.mts <outDir> <pdf...>");
}

const results = [];
for (const inputPath of inputPaths) {
  const bytes = await readFile(inputPath);
  const file = new File([bytes], inputPath.split(/[\\/]/).pop() ?? "labels.pdf", { type: "application/pdf" });
  const result = await parseFbaLabelPdf(file, `verify-${results.length + 1}`);
  results.push(result);
  console.log(JSON.stringify({
    fileName: result.fileName,
    pageCount: result.pageCount,
    ok: result.rows.filter((r) => r.status === "ok").length,
    errors: result.errors,
    first: result.rows.slice(0, 3).map((r) => r.boxId),
    last: result.rows.slice(-3).map((r) => r.boxId),
  }, null, 2));
  if (result.errors.length > 0) process.exit(1);
}

const zipBlob = await buildCombinedFbaLabelZip(results);
const arrayBuffer = await zipBlob.arrayBuffer();
await mkdir(outDir, { recursive: true });
const outPath = join(outDir, COMBINED_FBA_LABEL_ZIP_FILE_NAME);
await writeFile(outPath, Buffer.from(arrayBuffer));
const zip = await JSZip.loadAsync(arrayBuffer);
const names = Object.keys(zip.files);
console.log(JSON.stringify({
  combinedZipFileName: COMBINED_FBA_LABEL_ZIP_FILE_NAME,
  outPath,
  entries: names.length,
  firstEntries: names.slice(0, 3),
  lastEntries: names.slice(-3),
}, null, 2));
