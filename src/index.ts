import { scheduleJob } from 'node-schedule';
import mongoose from 'mongoose';
import config from "./config.json";
import skipRunConf from "./skip_run.json";
import * as Tasks from "./tasks";
import { logger } from "./utils/logger";
import { isNone } from "./utils/swissknife";
import { TwitchHelix } from "./utils/twitchapi";
import { YTRotatingAPIKey } from "./utils/ytkey_rotator";

let mongouri = config.mongodb.uri;
if (mongouri.endsWith("/")) {
    mongouri = mongouri.slice(0, -1);
}

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
    let totalRun = 0;
    if (config.workers.youtube && config.youtube.api_keys.length > 0) {
        logger.info("scheduler() Enabling Youtube API Keys Rotator...");
        let ytKeysAPI = new YTRotatingAPIKey(config.youtube.api_keys, config.youtube.rotation_rate);

        logger.info("scheduler() Adding jobs for youtube part...");
        scheduleJob(config.intervals.youtube.live, async () => await Tasks.handleYTLive(ytKeysAPI, skipRunConf));
        scheduleJob(config.intervals.youtube.feeds, async () => await Tasks.handleYTFeeds(ytKeysAPI, skipRunConf));
        scheduleJob(config.intervals.youtube.channels, async () => await Tasks.handleYTChannel(ytKeysAPI, skipRunConf));
        scheduleJob(config.intervals.youtube.missing_check, async () => await Tasks.handleYTMissing(ytKeysAPI, skipRunConf));
        totalRun += 3;
    }

    if (config.workers.bilibili) {
        // TODO: Implement
    }

    if (config.workers.twitch && !emptyData(config.twitch.client_id) && !emptyData(config.twitch.client_secret)) {
        logger.info("scheduler() Initializing Twitch Helix API...");
        let ttvHelix = new TwitchHelix(config.twitch.client_id, config.twitch.client_secret);

        logger.info("scheduler() Adding jobs for twitch part...");
        scheduleJob(config.intervals.twitch.live, async () => await Tasks.handleTTVLive(ttvHelix, skipRunConf));
        scheduleJob(config.intervals.twitch.channels, async () => await Tasks.handleTTVChannel(ttvHelix, skipRunConf));
        totalRun += 2;
    }

    if (config.workers.twitcasting) {
        logger.info("scheduler() Adding jobs for twitcasting part...");
        scheduleJob(config.intervals.twitcasting.live, async () => await Tasks.handleTWCastLive(skipRunConf));
        scheduleJob(config.intervals.twitcasting.channels, async () => await Tasks.handleTWCastChannel(skipRunConf));
        totalRun += 2;
    }
})();