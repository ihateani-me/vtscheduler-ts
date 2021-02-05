import _ from "lodash";
import moment from "moment-timezone";

import { VTuberModel } from "../dataset/model";

import {
    ChannelsData,
    ChannelsProps,
    ChannelStatsHistData,
    ChannelStatsHistProps
} from "../../src/models";
import { resolveDelayCrawlerPromises } from "../../src/utils/crawler";
import { logger } from "../../src/utils/logger";
import { MildomAPI } from "../../src/utils/mildomapi";
import { isNone } from "../../src/utils/swissknife";


export async function mildomChannelsDataset(mildomAPI: MildomAPI, dataset: VTuberModel[]) {
    let group = dataset[0]["id"];
    let channels: ChannelsProps[] = await ChannelsData.find({"group": {"$eq": dataset[0].id}, "platform": {"$eq": "mildom"}});
    let parsedChannelIds: string[] = channels.map(res => res.id);
    // @ts-ignore
    let filteredChannels = dataset.filter((res) => !parsedChannelIds.includes(res.mildom));
    if (filteredChannels.length < 1) {
        logger.warn(`mildomChannelDataset(${group}) no new channels to be registered`);
        return;
    }

    logger.info(`mildomChannelDataset(${group}) fetching to API...`);
    let mildomRequest = filteredChannels.map((chan) => (
        // @ts-ignore
        mildomAPI.fetchUser(chan.mildom).then((res) => {
            if (typeof res === "undefined") {
                return {};
            }
            res["en_name"] = chan.name;
            res["group"] = chan.id;
            return res;
        }).catch((err) => {
            logger.error(`mildomChannelDataset(${group}) error occured when fetching ${chan.name}, ${err.toString()}`);
            return {};
        })
    ))
    let mildomCrawlerDelayed = resolveDelayCrawlerPromises(mildomRequest, 300);
    // @ts-ignore
    let mildom_results: MildomChannelProps[] = await Promise.all(mildomCrawlerDelayed);
    logger.info(`mildomChannelDataset(${group}) parsing API results...`);
    let insertData = [];
    let currentTimestamp = moment.tz("UTC").unix();
    for (let i = 0; i < mildom_results.length; i++) {
        let result = mildom_results[i];
        if (isNone(result, true)) {
            continue;
        }
        logger.info(`mildomChannelDataset(${group}) parsing and fetching followers and videos ${result["id"]}`);
        let videosData = await mildomAPI.fetchVideos(result["id"]);
        let historyData: any[] = [];
        historyData.push({
            timestamp: currentTimestamp,
            followerCount: result["followerCount"],
            level: result["level"],
            videoCount: videosData.length,
        })
        // @ts-ignore
        let mappedNew: ChannelsProps = {
            "id": result["id"],
            "name": result["name"],
            "en_name": result["en_name"],
            "description": result["description"],
            "thumbnail": result["thumbnail"],
            "followerCount": result["followerCount"],
            "videoCount": videosData.length,
            "level": result["level"],
            "group": result["group"],
            "platform": "mildom",
        }
        insertData.push(mappedNew);
    }

    // @ts-ignore
    let historyDatas: ChannelStatsHistProps[] = insertData.map((res) => {
        let timestamp = moment.tz("UTC").unix();
        return {
            id: res["id"],
            history: [
                {
                    timestamp: timestamp,
                    followerCount: res["followerCount"],
                    level: res["level"],
                    videoCount: res["videoCount"],
                }
            ],
            group: res["group"],
            platform: "mildom"
        }
    });

    if (insertData.length > 0) {
        logger.info(`mildomChannelDataset(${group}) committing new data...`);
        await ChannelsData.insertMany(insertData).catch((err) => {
            logger.error(`mildomChannelDataset(${group}) failed to insert new data, ${err.toString()}`);
        });
    }
    if (historyDatas.length > 1) {
        logger.info(`mildomChannelDataset(${group}) committing new history data...`);
        await ChannelStatsHistData.insertMany(historyDatas).catch((err) => {
            logger.error(`mildomChannelDataset(${group}) failed to insert new history data, ${err.toString()}`);
        })
    }
}