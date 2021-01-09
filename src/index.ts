import { scheduleJob } from 'node-schedule';
import mongoose from 'mongoose';
import config from "./config.json";
import * as Tasks from "./tasks";
import { logger } from "./utils/logger";
import { isNone } from "./utils/swissknife";
import { TwitchHelix } from "./utils/twitchapi";
import { YTRotatingAPIKey } from "./utils/ytkey_rotator";

let mongouri = config.mongodb.uri;
if (mongouri.endsWith("/")) {
    mongouri = mongouri.slice(0, -1);
}

const filtersConfig = config["filters"];

logger.info("Connecting to database...");
mongoose.connect(`${mongouri}/${config.mongodb.dbname}`, {useNewUrlParser: true, useUnifiedTopology: true, useFindAndModify: false});

if (!config.workers.youtube && !config.workers.bilibili && !config.workers.twitcasting && !config.workers.twitch) {
    logger.info("There's no worker enable, shutting down");
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

        logger.info("scheduler() Adding jobs for youtube part...");
        if (typeof config.intervals.youtube.live === "string") {
            scheduleJob({rule: config.intervals.youtube.live, tz: "Asia/Tokyo"}, async () => Tasks.handleYTLive(ytKeysAPI, filtersConfig));
            totalWorkers++;
        }
        if (typeof config.intervals.youtube.feeds === "string") {
            scheduleJob({rule: config.intervals.youtube.feeds, tz: "Asia/Tokyo"}, async () => Tasks.handleYTFeeds(ytKeysAPI, filtersConfig));
            totalWorkers++;
        }
        if (typeof config.intervals.youtube.channels === "string") {
            scheduleJob({rule: config.intervals.youtube.channels, tz: "Asia/Tokyo"}, async () => Tasks.handleYTChannel(ytKeysAPI, filtersConfig));
            totalWorkers++;
        }
        if (typeof config.intervals.youtube.missing_check === "string") {
            scheduleJob({rule: config.intervals.youtube.missing_check, tz: "Asia/Tokyo"}, async () => Tasks.handleYTMissing(ytKeysAPI, filtersConfig));
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

        logger.info("scheduler() Adding jobs for twitch part...");
        if (typeof config.intervals.twitch.live === "string") {
            scheduleJob({rule: config.intervals.twitch.live, tz: "Asia/Tokyo"}, async () => Tasks.handleTTVLive(ttvHelix, filtersConfig));
            totalWorkers++;
        }
        if (typeof config.intervals.twitch.channels === "string") {
            scheduleJob({rule: config.intervals.twitch.channels, tz: "Asia/Tokyo"}, async () => Tasks.handleTTVChannel(ttvHelix, filtersConfig));
            totalWorkers++;
        }
    }

    if (config.workers.twitcasting) {
        logger.info("scheduler() Adding jobs for twitcasting part...");
        if (typeof config.intervals.twitcasting.live === "string") {
            scheduleJob({rule: config.intervals.twitcasting.live, tz: "Asia/Tokyo"}, async () => Tasks.handleTWCastLive(filtersConfig));
            totalWorkers++;
        }
        if (typeof config.intervals.twitcasting.channels === "string") {
            scheduleJob({rule: config.intervals.twitcasting.channels, tz: "Asia/Tokyo"}, async () => Tasks.handleTWCastChannel(filtersConfig));
            totalWorkers++;
        }
    }
    logger.info(`scheduler() running ${totalWorkers} workers...`);
})();