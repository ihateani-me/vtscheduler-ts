
import { createInterface } from 'readline';
import mongoose from "mongoose";
import { YTRotatingAPIKey } from '../src/utils/ytkey_rotator';
import config from "../src/config.json";
import { readdirSync, readFileSync } from "fs"
import { logger } from '../src/utils/logger';
import { join } from "path";
import { DatasetModel, VTuberModel } from './dataset/model';
import _ from 'lodash';
import { ttvChannelDataset, youtubeChannelDataset } from './controller';
import { TwitchHelix } from '../src/utils/twitchapi';
import { isNone } from '../src/utils/swissknife';

let mongouri = config.mongodb.uri;
if (mongouri.endsWith("/")) {
    mongouri = mongouri.slice(0, -1);
}

mongoose.connect(`${mongouri}/${config.mongodb.dbname}`, {useNewUrlParser: true, useUnifiedTopology: true});

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
        "[5] Exit\n"
    );
    const int = createInterface(process.stdin, process.stdout);
    int.question("Select: ", async input => {
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
                process.exit(0);
            default:
                return menuController();
        }
        delayEnd();
    })
}

const delayEnd = () => setTimeout(() => {
    console.log("Press any key to continue: ");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', process.exit.bind(process, 0));
}, 600);

async function scrapeAndUpdate(filename: string, twitchAPI?: TwitchHelix) {
    let datasetRead: DatasetModel = JSON.parse(readFileSync(join(__dirname, "dataset", filename), "utf-8"));
    let youtubeData: VTuberModel[] = datasetRead.vliver.filter(f => _.has(f, "youtube")).map((d) => {
        d["id"] = datasetRead["id"];
        return d;
    });
    let bilibiliData: VTuberModel[] = datasetRead.vliver.filter(f => _.has(f, "bilibili")).map((d) => {
        d["id"] = datasetRead["id"];
        return d;
    });
    let ttvData: VTuberModel[] = datasetRead.vliver.filter(f => _.has(f, "twitch")).map((d) => {
        d["id"] = datasetRead["id"];
        return d;
    });
    let twcastData: VTuberModel[] = datasetRead.vliver.filter(f => _.has(f, "twitcasting")).map((d) => {
        d["id"] = datasetRead["id"];
        return d;
    });
    if (config.workers.youtube) {
        // 25 secs
        let ytRotator = new YTRotatingAPIKey(config.youtube.api_keys, 0.4166666675);
        await youtubeChannelDataset(youtubeData, ytRotator);
    }
    if (config.workers.bilibili) {

    }
    if (config.workers.twitcasting) {

    }
    if (config.workers.twitch && typeof twitchAPI !== "undefined") {
        await ttvChannelDataset(ttvData, twitchAPI);
    }
}

async function propagateAndUpdate() {
    if (config.youtube.api_keys.length < 1 && config.workers.youtube) {
        logger.error("propagateAndUpdate() missing youtube API keys to use");
    }
    let twitchAPI: TwitchHelix;
    if (config.twitch.client_id && config.twitch.client_secret) {
        logger.info("propagateAndUpdate() initializing twitch API")
        twitchAPI = new TwitchHelix(config.twitch.client_id, config.twitch.client_secret);
        await twitchAPI.authorizeClient();
    }

    let allDatasets = readdirSync(join(__dirname, "dataset"))
        .filter(f => f.endsWith(".json"))
        .flatMap(async (group): Promise<void> => await scrapeAndUpdate(group, twitchAPI));
    await Promise.all(allDatasets).catch((err) => {
        logger.error(`propagateAndUpdate() failed to propagate, ${err.toString()}`);
    });
}

async function nukeCollection() {

}

async function nukeDatabase() {

}

async function initialize() {

}