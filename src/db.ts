import { PrismaClient } from "@prisma/client";
import Database from "bun:sqlite";

export const db = new PrismaClient();
export const logdb = new Database("logdb.sqlite", { create: true });
logdb.exec("PRAGMA journal_mode = WAL;");
logdb.run(`
CREATE TABLE IF NOT EXISTS LogFile (
  path TEXT,
  lastWrite INTEGER
);
`);
