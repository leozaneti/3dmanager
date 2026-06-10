import fs from "node:fs";
import path from "node:path";

const dbPath = path.resolve("data", "test.sqlite");

export function deleteDb() {
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
}

export function getDbPath() {
  return dbPath;
}
