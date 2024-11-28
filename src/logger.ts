import { createPinoLogger, pino } from "@bogeychan/elysia-logger";
import { join, dirname, resolve } from "path";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from "fs";
import pretty from "pino-pretty";
import { Glob } from "bun";
import { gzip } from "node-gzip";

const logRoot = resolve(process.env.LOG_ROOT ?? "logs");

// 로그 초기화 및 기존 로그 압축
if (existsSync(logRoot)) {
  // 이중 압축을 피하기 위해 .out으로 고정
  const g = new Glob("**/*.out");
  const t = new Date().getTime();
  for (const fileName of g.scanSync(logRoot)) {
    const file = join(logRoot, fileName);
    const compressed = await gzip(await Bun.file(file).arrayBuffer());
    await Bun.write(file + ".gz", compressed.buffer);
    rmSync(file);
  }
  const archivedLogsPath = join(dirname(__dirname), "archived-logs");
  if (!existsSync(archivedLogsPath)) {
    mkdirSync(archivedLogsPath);
  }
  renameSync(logRoot, join(archivedLogsPath, `archived-${t}`));
}
mkdirSync(logRoot);

export const logFilePath = join(logRoot, `log.stream.out`);
export const errorFilePath = join(logRoot, `error.stream.out`);
const logStream = createWriteStream(logFilePath);
const errorStream = createWriteStream(errorFilePath);

const stream = pino.multistream([
  {
    level: "debug",
    stream: logStream,
  },
  {
    level: "warn",
    stream: errorStream,
  },
  {
    level: "info",
    stream: pretty({ colorize: true }),
  },
]);

export const logger = createPinoLogger({
  level: "debug",
  stream,
});

function makeLoggerPath(id: string): [string, string] {
  const now = new Date();
  const nowDate = new Intl.DateTimeFormat("ko", {
    dateStyle: "short",
    timeZone: "Asia/Seoul",
  })
    .format(now)
    .replaceAll(/\.\s?/g, "-")
    .slice(0, -1);
  const nowTime = new Intl.DateTimeFormat("ko", {
    timeStyle: "medium",
    hour12: false,
    timeZone: "Asia/Seoul",
  })
    .format(now)
    .replaceAll(":", "-");
  const logDir = join(logRoot, id, `${nowDate}.out.d`);
  const errorLogDir = join(logRoot, id, `${nowDate}.error.d`);
  const logPath = join(logDir, nowTime + ".out");
  const errorLogPath = join(errorLogDir, nowTime + ".out");
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  if (!existsSync(errorLogDir)) {
    mkdirSync(errorLogDir, { recursive: true });
  }
  return [logPath, errorLogPath];
}

function buildGeneralLogger(
  logPath: string,
  errorLogPath: string,
  loggerName: string,
) {
  return [
    createPinoLogger({
      level: "debug",
      stream: pino.multistream([
        {
          level: "debug",
          stream: createWriteStream(logPath),
        },
        {
          level: "warn",
          stream: createWriteStream(errorLogPath),
        },
        {
          level: "info",
          stream: pretty({ colorize: true }),
        },
      ]),
      name: loggerName,
    }),
    logPath,
    errorLogPath,
  ] as const;
}

export function moLoggerBuilder() {
  const loggerPaths = makeLoggerPath("mo");
  return buildGeneralLogger(...loggerPaths, "MarkOutdateService");
}

export function fgiLoggerBuilder() {
  const loggerPaths = makeLoggerPath("fgi");
  return buildGeneralLogger(...loggerPaths, "FetchGameInfoService");
}

export function pcLoggerBuilder() {
  const loggerPaths = makeLoggerPath("pc");
  return buildGeneralLogger(...loggerPaths, "PlayerCountService");
}
