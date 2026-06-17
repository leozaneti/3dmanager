import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { db } from "../db.js";

const backupDir = path.resolve("data", "backups");

function backupFilePaths() {
  return fs.readdirSync(backupDir).filter((f) => f.endsWith(".sqlite")).map((f) => {
    const full = path.join(backupDir, f);
    let date = f.replace(/^backup-|\.sqlite$/g, "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    } else if (/^\d{4}-\d{2}-\d{2}T/.test(date)) {
      date = date.slice(0, 10);
    } else {
      date = "";
    }
    return { name: f, full, size: fs.statSync(full).size, date };
  }).filter((f) => f.date).sort((a, b) => b.date.localeCompare(a.date));
}

function pruneBackups() {
  const files = backupFilePaths();
  const now = Date.now();
  const ms30d = 30 * 24 * 60 * 60 * 1000;
  const keep = new Set<string>();
  const monthGroups = new Map<string, { name: string; date: string }[]>();

  for (const f of files) {
    if (!/^backup-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f.name)) {
      fs.unlinkSync(f.full);
      continue;
    }
    const age = now - new Date(f.date + "T00:00:00").getTime();
    if (age <= ms30d) {
      keep.add(f.name);
    } else {
      const month = f.date.slice(0, 7);
      if (!monthGroups.has(month)) monthGroups.set(month, []);
      monthGroups.get(month)!.push(f);
    }
  }

  for (const [, group] of monthGroups) {
    group.sort((a, b) => b.date.localeCompare(a.date));
    keep.add(group[0].name);
  }

  for (const f of files) {
    if (!keep.has(f.name)) fs.unlinkSync(f.full);
  }
}

function runBackup() {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10);
  const target = path.join(backupDir, `backup-${stamp}.sqlite`);
  db.backup(target);
  pruneBackups();
}

function maybeBackup() {
  const stamp = new Date().toISOString().slice(0, 10);
  const files = fs.readdirSync(backupDir).filter((f) => f === `backup-${stamp}.sqlite`);
  if (files.length === 0) runBackup();
  pruneBackups();
}

export default function registerBackupRoutes(app: FastifyInstance) {
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  setInterval(() => maybeBackup(), 60 * 60 * 1000);

  app.get("/api/backups", () => {
    const files = backupFilePaths();
    const totalSizeBytes = files.reduce((s, f) => s + f.size, 0);
    return { files: files.slice(0, 60), totalFiles: files.length, totalSizeBytes, latestDate: files[0]?.date ?? null };
  });

  app.post("/api/backups", () => {
    runBackup();
    const files = backupFilePaths();
    const totalSizeBytes = files.reduce((s, f) => s + f.size, 0);
    return { latestDate: files[0]?.date ?? null, totalFiles: files.length, totalSizeBytes };
  });

  maybeBackup();
}
