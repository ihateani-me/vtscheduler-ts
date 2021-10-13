import _ from "lodash";
import mongoose from "mongoose";
import { createInterface } from "readline";
import { join } from "path";
import { readdirSync, readFileSync } from "fs";

import { Migrator } from "./migrations";
import { DatasetModel, VTuberModel } from "./dataset/model";
import {
    bilibiliChannelsDataset,
    mildomChannelsDataset,
    ttvChannelDataset,
    twcastChannelsDataset,
    twitterChannelDataset,
    youtubeChannelDataset,
} from "./controller";

import { logger } from "../src/utils/logger";
import { YTRotatingAPIKey } from "../src/utils/ytkey_rotator";
import { TwitchHelix } from "../src/utils/twitchapi";
import { TwitterAPI } from "../src/utils/twspaces";
import { MildomAPI } from "../src/utils/mildomapi";

import config from "../src/config.json";

let mongouri = config.mongodb.uri;
if (mongouri.endsWith("/")) {
    mongouri = mongouri.slice(0, -1);
}

mongoose.connect(`${mongouri}/${config.mongodb.dbname}`, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    useFindAndModify: false,
});

export function menuController() {
    console.clear();
    console.log(
        "-------------------- Channel Manager --------------------\n" +
            "Make sure your json dataset in dataset/ folder\n" +
            "If you want to add custom one, please follow the template\n" +
            "---------------------------------------------------------\n" +
            "[1] Initialize new database\n" +
            "[2] Scrape Missing & Update database list\n" +
            "[3] Nuke all channel collection\n" +
            "[4] Nuke database\n" +
            "[5] Migrate database\n" +
            "[6] Exit\n"
    );
    const int = createInterface(process.stdin, process.stdout);
    int.question("Select: ", async (input) => {
        int.close();
        switch (input) {
            case "1":
                await initialize();
                break;
            case "2":
                await propagateAndUpdate();
                break;
            case "3":
                await nukeCollection();
                break;
            case "4":
                await nukeDatabase();
                break;
            case "5":
                await migrateSchema();
                break;
            case "6":
                process.exit(0);
            default:
                return menuController();
        }
        delayEnd();
    });
}

const delayEnd = () =>
    setTimeout(() => {
        console.log("Press any key to continue: ");
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on("data", process.exit.bind(process, 0));
    }, 600);

async function scrapeAndUpdate(filename: string, twitchAPI?: TwitchHelix, mildomAPI?: MildomAPI, twtAPI?: TwitterAPI) {
    logger.info(`scrapeAndUpdate() processing group: ${filename}`);
    let datasetRead: DatasetModel = JSON.parse(readFileSync(join(__dirname, "dataset", filename), "utf-8"));
    if (!_.has(datasetRead, "id")) {
        logger.warn(`scrapeAndUpdate() ${filename} missing id key`);
        datasetRead["id"] = filename.slice(0, -5);
    }
    let youtubeData: VTuberModel[] = datasetRead.vliver
        .filter((f) => _.has(f, "youtube"))
        .map((d) => {
            d["id"] = datasetRead["id"];
            return d;
        });
    let bilibiliData: VTuberModel[] = datasetRead.vliver
        .filter((f) => _.has(f, "bilibili"))
        .map((d) => {
            d["id"] = datasetRead["id"];
            return d;
        });
    let ttvData: VTuberModel[] = datasetRead.vliver
        .filter((f) => _.has(f, "twitch"))
        .map((d) => {
            d["id"] = datasetRead["id"];
            return d;
        });
    let twcastData: VTuberModel[] = datasetRead.vliver
        .filter((f) => _.has(f, "twitcasting"))
        .map((d) => {
            d["id"] = datasetRead["id"];
            return d;
        });
    let mildomData: VTuberModel[] = datasetRead.vliver
        .filter((f) => _.has(f, "mildom"))
        .map((d) => {
            d["id"] = datasetRead["id"];
            return d;
        });
    let twitterData: VTuberModel[] = datasetRead.vliver
        .filter((f) => _.has(f, "twitter"))
        .map((d) => {
            d["id"] = datasetRead["id"];
            return d;
        });

    if (config.workers.youtube && youtubeData.length > 0) {
        // 25 secs
        logger.info("scrapeAndUpdate() running youtube scraper...");
        logger.info(`scrapeAndUpdate() youtube: ${youtubeData.length}`);
        let ytRotator = new YTRotatingAPIKey(config.youtube.api_keys, 0.4166666675);
        await youtubeChannelDataset(youtubeData, ytRotator);
    }
    if (config.workers.bilibili && bilibiliData.length > 0) {
        logger.info("scrapeAndUpdate() running bilibili scraper...");
        logger.info(`scrapeAndUpdate() bilibili: ${bilibiliData.length}`);
        await bilibiliChannelsDataset(bilibiliData);
    }
    if (config.workers.twitcasting && twcastData.length > 0) {
        logger.info("scrapeAndUpdate() running twitcasting scraper...");
        logger.info(`scrapeAndUpdate() twitcasting: ${twcastData.length}`);
        await twcastChannelsDataset(twcastData);
    }
    if (config.workers.twitch && typeof twitchAPI !== "undefined" && ttvData.length > 0) {
        logger.info("scrapeAndUpdate() running twitch scraper...");
        logger.info(`scrapeAndUpdate() twitch: ${ttvData.length}`);
        await ttvChannelDataset(ttvData, twitchAPI);
    }
    if (config.workers.mildom && mildomData.length > 0 && typeof mildomAPI !== "undefined") {
        logger.info("scrapeAndUpdate() running mildom scraper...");
        logger.info(`scrapeAndUpdate() mildom: ${mildomData.length}`);
        await mildomChannelsDataset(mildomAPI, mildomData);
    }
    if (config.workers.twitter && twitterData.length > 0 && typeof twtAPI !== "undefined") {
        logger.info("scrapeAndUpdate() running twitter scraper...");
        logger.info(`scrapeAndUpdate() twitter: ${twitterData.length}`);
        await twitterChannelDataset(twitterData, twtAPI);
    }
}

async function propagateAndUpdate() {
    if (config.youtube.api_keys.length < 1 && config.workers.youtube) {
        logger.error("propagateAndUpdate() missing youtube API keys to use");
    }
    let twitchAPI: TwitchHelix;
    let mildomAPI = new MildomAPI();
    let twitterAPI: TwitterAPI | undefined = undefined;
    if (config.twitch.client_id && config.twitch.client_secret && config.workers.twitch) {
        logger.info("propagateAndUpdate() initializing twitch API");
        twitchAPI = new TwitchHelix(config.twitch.client_id, config.twitch.client_secret);
        await twitchAPI.authorizeClient();
    }
    if (config.twitter.token && config.workers.twitter) {
        logger.info("propagateAndUpdate() initializing twitter API");
        twitterAPI = new TwitterAPI(config.twitter.token);
    }

    let allDatasets = readdirSync(join(__dirname, "dataset"))
        .filter((f) => f.endsWith(".json"))
        .flatMap(async (group): Promise<void> => await scrapeAndUpdate(group, twitchAPI, mildomAPI, twitterAPI));
    await Promise.all(allDatasets).catch((err: any) => {
        logger.error(`propagateAndUpdate() failed to propagate, ${err.toString()}`);
        logger.error(err);
    });
}

async function nukeCollection() {}

async function nukeDatabase() {}

async function migrateSchema() {
    await Migrator();
}

async function initialize() {}
