import mongoose from "mongoose";
import { scheduleJob } from "node-schedule";

import { logger } from "./utils/logger";
import { isNone } from "./utils/swissknife";
import { TwitchHelix } from "./utils/twitchapi";
import { TwitterAPI } from "./utils/twspaces";
import { YTRotatingAPIKey } from "./utils/ytkey_rotator";

import * as Tasks from "./tasks";

import config from "./config.json";

let mongouri = config.mongodb.uri;
if (mongouri.endsWith("/")) {
    mongouri = mongouri.slice(0, -1);
}

const filtersConfig = config["filters"];

logger.info("Connecting to database...");
mongoose.connect(`${mongouri}/${config.mongodb.dbname}`, {useNewUrlParser: true, useUnifiedTopology: true, useFindAndModify: false});

if (!config.workers.youtube && !config.workers.bilibili && !config.workers.twitcasting && !config.workers.twitch && !config.workers.twitter) {
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
        const ytKeysAPI = new YTRotatingAPIKey(config.youtube.api_keys, config.youtube.rotation_rate);
        const YTTasks = new Tasks.YouTubeTasks(ytKeysAPI, filtersConfig);

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
        const B2Tasks = new Tasks.BilibiliTasks(filtersConfig);

        if (typeof config.intervals.bilibili.upcoming === "string") {
            scheduleJob({rule: config.intervals.bilibili.upcoming, tz: "Asia/Shanghai"}, async () => await B2Tasks.handleB2Feeds());
            totalWorkers++;
        }
        if (typeof config.intervals.bilibili.live === "string") {
            scheduleJob({rule: config.intervals.bilibili.live, tz: "Asia/Shanghai"}, async () => await B2Tasks.handleB2Live());
            totalWorkers++;
        }
        if (typeof config.intervals.bilibili.channels === "string") {
            scheduleJob({rule: config.intervals.bilibili.channels, tz: "Asia/Shanghai"}, async () => await B2Tasks.handleB2Channels());
            totalWorkers++;
        }
    }

    if (config.workers.twitch && !emptyData(config.twitch.client_id) && !emptyData(config.twitch.client_secret)) {
        logger.info("scheduler() Initializing Twitch Helix API...");
        const ttvHelix = new TwitchHelix(config.twitch.client_id, config.twitch.client_secret);
        const TTVTasks = new Tasks.TwitchTasks(ttvHelix, filtersConfig);

        logger.info("scheduler() Adding jobs for twitch part...");
        if (typeof config.intervals.twitch.live === "string") {
            scheduleJob({rule: config.intervals.twitch.live, tz: "Asia/Tokyo"}, async () => TTVTasks.handleTTVLive());
            totalWorkers++;
        }
        if (typeof config.intervals.twitch.feeds === "string") {
            scheduleJob({rule: config.intervals.twitch.feeds, tz: "Asia/Tokyo"}, async () => TTVTasks.handleTTVSchedules());
            totalWorkers++;
        }
        if (typeof config.intervals.twitch.channels === "string") {
            scheduleJob({rule: config.intervals.twitch.channels, tz: "Asia/Tokyo"}, async () => TTVTasks.handleTTVChannel());
            totalWorkers++;
        }
    }

    if (config.workers.twitcasting) {
        logger.info("scheduler() Adding jobs for twitcasting part...");
        const TWCastTasks = new Tasks.TwitcastingTasks(filtersConfig);
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
        const MildomTasks = new Tasks.MildomTasks(filtersConfig);
        if (typeof config.intervals.mildom.live === "string") {
            scheduleJob({rule: config.intervals.mildom.live, tz: "Asia/Tokyo"}, async () => MildomTasks.handleMildomLive());
            totalWorkers++;
        }
        if (typeof config.intervals.mildom.channels === "string") {
            scheduleJob({rule: config.intervals.mildom.channels, tz: "Asia/Tokyo"}, async () => MildomTasks.handleMildomChannel());
            totalWorkers++;
        }
    }

    if (config.workers.twitter && !emptyData(config?.twitter?.token)) {
        logger.info("scheduler() Adding jobs for twitter part...");
        const twtAPI = new TwitterAPI(config.twitter.token)
        const TwitterTasks = new Tasks.TwitterTasks(twtAPI, filtersConfig);
        if (typeof config.intervals.twitter.live === "string") {
            scheduleJob({rule: config.intervals.twitter.live, tz: "Asia/Tokyo"}, async () => TwitterTasks.handleTwitterLive());
            totalWorkers++;
        }
        if (typeof config.intervals.twitter.feeds === "string") {
            scheduleJob({rule: config.intervals.twitter.feeds, tz: "Asia/Tokyo"}, async () => TwitterTasks.handleTwitchFeeds());
            totalWorkers++;
        }
        if (typeof config.intervals.twitter.channels === "string") {
            scheduleJob({rule: config.intervals.twitter.channels, tz: "Asia/Tokyo"}, async () => TwitterTasks.handleTwitterChannels());
            totalWorkers++;
        }
    }

    logger.info(`scheduler() running ${totalWorkers} workers...`);
})();
