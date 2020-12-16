import winston, { createLogger } from "winston";

const logger = createLogger({
    level: "info",
    format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf((info) => {
            return `[${info["timestamp"]}][${info.level}]: ${info.message}`;
        })
    ),
    transports: [
        new winston.transports.File({filename: "vt.log"}),
        new winston.transports.Console()
    ]
});

export {logger};