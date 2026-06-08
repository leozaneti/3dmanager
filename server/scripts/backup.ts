import fs from "node:fs";
import path from "node:path";
import { db, migrate } from "../db.js";

migrate();

const env = process.env.DB_ENV || "prod";

const backupDir = path.resolve("data", "backups");
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = path.join(backupDir, `${env}-${stamp}.sqlite`);
await db.backup(target);
console.log(`Backup criado em ${target}`);
