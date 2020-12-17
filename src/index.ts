import Codic from "codic";
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
mongoose.connect(`${mongouri}/${config.mongodb.dbname}`, {useNewUrlParser: true, useUnifiedTopology: true});

const codic = new Codic();

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
        logger.info("codic() Enabling Youtube API Keys Rotator...");
        let ytKeysAPI = new YTRotatingAPIKey(config.youtube.api_keys, config.youtube.rotation_rate);

        logger.info("codic() Adding jobs for youtube part...");
        await codic.assign("youtube channels", Tasks.handleYTChannel);
        await codic.assign("youtube feeds", Tasks.handleYTFeeds);
        await codic.assign("youtube live heartbeat", Tasks.handleYTLive);
    
        await codic.run("youtube channels")
                    .use({ytKeys: ytKeysAPI, skipRun: skipRunConf})
                    .every(`${config.intervals.youtube.channels} minutes`)
                    .save();
        await codic.run("youtube feeds")
                    .use({ytKeys: ytKeysAPI, skipRun: skipRunConf})
                    .every(`${config.intervals.youtube.feeds} minutes`)
                    .save();
        await codic.run("youtube live heartbeat")
                    .use({ytKeys: ytKeysAPI, skipRun: skipRunConf})
                    .every(`${config.intervals.youtube.live} minutes`)
                    .save();
        totalRun += 3;
    }

    if (config.workers.bilibili) {
        // TODO: Implement
    }

    if (config.workers.twitch && !emptyData(config.twitch.client_id) && !emptyData(config.twitch.client_secret)) {
        logger.info("codic() Initializing Twitch Helix API...");
        let ttvHelix = new TwitchHelix(config.twitch.client_id, config.twitch.client_secret);

        logger.info("codic() Adding jobs for twitch part...");
        await codic.assign("ttv channels", Tasks.handleTTVChannel);
        await codic.assign("ttv live heartbeat", Tasks.handleTTVLive);
        await codic.run("ttv channels")
                    .use({ttvAPI: ttvHelix, skipRun: skipRunConf})
                    .every(`${config.intervals.twitch.channels} minutes`)
                    .save();
        await codic.run("ttv live heartbeat")
                    .use({ttvAPI: ttvHelix, skipRun: skipRunConf})
                    .every(`${config.intervals.twitch.live} minutes`)
                    .save();
        totalRun += 2;
    }

    if (config.workers.twitcasting) {
        logger.info("codic() Adding jobs for twitcasting part...");
        await codic.assign("twcast channels", Tasks.handleTTVChannel);
        await codic.assign("twcast live heartbeat", Tasks.handleTTVLive);
        await codic.run("twcast channels")
                    .use({skipRun: skipRunConf})
                    .every(`${config.intervals.twitcasting.channels} minutes`)
                    .save();
        await codic.run("twcast live heartbeat")
                    .use({skipRun: skipRunConf})
                    .every(`${config.intervals.twitcasting.live} minutes`)
                    .save();
        totalRun += 2;
    }

    if (totalRun > 0) {
        logger.info(`codic() starting codic scheduler, total tasks: ${totalRun} tasks!`);
        await codic.start();
    } else {
        logger.warn("codic() no task are being scheduled, shutting down!");
        return;
    }
})();