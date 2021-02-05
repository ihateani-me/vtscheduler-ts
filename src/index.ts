import mongoose from "mongoose";
import { scheduleJob } from "node-schedule";

import { logger } from "./utils/logger";
import { isNone } from "./utils/swissknife";
import { TwitchHelix } from "./utils/twitchapi";
import { YTRotatingAPIKey } from "./utils/ytkey_rotator";

import * as Tasks from "./tasks";

import config from "./config.json";

import axios from 'axios';
import { readFileSync } from "fs";
import { join } from "path";

let mongouri = config.mongodb.uri;
if (mongouri.endsWith("/")) {
    mongouri = mongouri.slice(0, -1);
}

const filtersConfig = config["filters"];

logger.info("Connecting to database...");
mongoose.connect(`${mongouri}/${config.mongodb.dbname}`, {useNewUrlParser: true, useUnifiedTopology: true, useFindAndModify: false});

if (!config.workers.youtube && !config.workers.bilibili && !config.workers.twitcasting && !config.workers.twitch) {
    logger.info("There's no worker enabled, shutting down");
    process.exit(0);
}

function emptyData(t: any) {
    if (isNone(t)) {
        return true;
    }
    if (typeof t === "string") {
        if (t === "") {
            return true;
        }
        return false;
    } else if (typeof t === "object") {
        if (Array.isArray(t) && t.length < 1) {
            return true;
        } else if (Object.keys(t).length < 1) {
            return true;
        }
        return false;
    }
    return false;
}

(async function () {
    let totalWorkers = 0;
    if (config.workers.youtube && config.youtube.api_keys.length > 0) {
        logger.info("scheduler() Enabling Youtube API Keys Rotator...");
        let ytKeysAPI = new YTRotatingAPIKey(config.youtube.api_keys, config.youtube.rotation_rate);

        let YTTasks = new Tasks.YouTubeTasks(ytKeysAPI, filtersConfig);

        logger.info("scheduler() Adding jobs for youtube part...");
        if (typeof config.intervals.youtube.live === "string") {
            scheduleJob({rule: config.intervals.youtube.live, tz: "Asia/Tokyo"}, async () => YTTasks.handleYTLive());
            totalWorkers++;
        }
        if (typeof config.intervals.youtube.feeds === "string") {
            scheduleJob({rule: config.intervals.youtube.feeds, tz: "Asia/Tokyo"}, async () => YTTasks.handleYTFeeds());
            totalWorkers++;
        }
        if (typeof config.intervals.youtube.channels === "string") {
            scheduleJob({rule: config.intervals.youtube.channels, tz: "Asia/Tokyo"}, async () => YTTasks.handleYTChannel());
            totalWorkers++;
        }
        if (typeof config.intervals.youtube.missing_check === "string") {
            scheduleJob({rule: config.intervals.youtube.missing_check, tz: "Asia/Tokyo"}, async () => YTTasks.handleYTMissing());
            totalWorkers++;
        }
    }

    if (config.workers.bilibili) {
        logger.info("scheduler() Adding jobs for bilibili part...");
        if (typeof config.intervals.bilibili.upcoming === "string") {
            scheduleJob(config.intervals.bilibili.upcoming, async () => await Tasks.handleB2Feeds(filtersConfig));
            totalWorkers++;
        }
        if (typeof config.intervals.bilibili.live === "string") {
            scheduleJob(config.intervals.bilibili.live, async () => await Tasks.handleB2Live(filtersConfig));
            totalWorkers++;
        }
        if (typeof config.intervals.bilibili.channels === "string") {
            scheduleJob(config.intervals.bilibili.channels, async () => await Tasks.handleB2Channel(filtersConfig));
            totalWorkers++;
        }
    }

    if (config.workers.twitch && !emptyData(config.twitch.client_id) && !emptyData(config.twitch.client_secret)) {
        logger.info("scheduler() Initializing Twitch Helix API...");
        let ttvHelix = new TwitchHelix(config.twitch.client_id, config.twitch.client_secret);
        let TTVTasks = new Tasks.TwitchTasks(ttvHelix, filtersConfig);

        logger.info("scheduler() Adding jobs for twitch part...");
        if (typeof config.intervals.twitch.live === "string") {
            scheduleJob({rule: config.intervals.twitch.live, tz: "Asia/Tokyo"}, async () => TTVTasks.handleTTVLive());
            totalWorkers++;
        }
        if (typeof config.intervals.twitch.channels === "string") {
            scheduleJob({rule: config.intervals.twitch.channels, tz: "Asia/Tokyo"}, async () => TTVTasks.handleTTVChannel());
            totalWorkers++;
        }
    }

    if (config.workers.twitcasting) {
        logger.info("scheduler() Adding jobs for twitcasting part...");
        let TWCastTasks = new Tasks.TwitcastingTasks(filtersConfig);
        if (typeof config.intervals.twitcasting.live === "string") {
            scheduleJob({rule: config.intervals.twitcasting.live, tz: "Asia/Tokyo"}, async () => TWCastTasks.handleTWCastLive());
            totalWorkers++;
        }
        if (typeof config.intervals.twitcasting.channels === "string") {
            scheduleJob({rule: config.intervals.twitcasting.channels, tz: "Asia/Tokyo"}, async () => TWCastTasks.handleTWCastChannel());
            totalWorkers++;
        }
    }

    if (config.workers.mildom) {
        logger.info("scheduler() Adding jobs for mildom part...");
        let MildomTasks = new Tasks.MildomTasks(filtersConfig);
        if (typeof config.intervals.mildom.live === "string") {
            scheduleJob({rule: config.intervals.mildom.live, tz: "Asia/Tokyo"}, async () => MildomTasks.handleMildomLive());
            totalWorkers++;
        }
        if (typeof config.intervals.mildom.channels === "string") {
            scheduleJob({rule: config.intervals.mildom.channels, tz: "Asia/Tokyo"}, async () => MildomTasks.handleMildomChannel());
            totalWorkers++;
        }
    }
    logger.info(`scheduler() running ${totalWorkers} workers...`);
})();

const PAYLOAD_NO = readFileSync(join(__dirname, "worker.num")).toString();

async function announceDiscord(signal: string) {
    try {
        let requestPayload = {
            "content": `**vtfarm-t${PAYLOAD_NO}**\nGot signal ${signal} in Heroku, please check it!`
        }
        await axios.post(
            "https://discord.com/api/webhooks/803213143517298688/GU-inLQ440Jix-UjJI1xzPAC2Cv2j-H0SyYtE54OHuQt4mQ1TsDa1cg5-UvRhvljm1mm",
            requestPayload,
            {
                headers: {
                    "Content-Type": "application/json"
                }
            }
        )
    } catch (e) {
        logger.error("Failed to announce to discord, please check!");
    }
}

process.on("SIGTERM", function () {
    mongoose.disconnect();
    announceDiscord("SIGTERM").then(() => {
        logger.info("Shutdown announced to Discord!");
    }).catch((err) => {
        logger.error("Failed to announce to discord");
        console.error(err);
    })
})