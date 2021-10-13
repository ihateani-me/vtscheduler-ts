import { DateTime } from "luxon";

import { VTuberModel } from "../dataset/model";

import { ChannelsData, ChannelsProps, ChannelStatsHistData, ChannelStatsHistProps } from "../../src/models";
import { BiliIDwithGroup, fetchChannelsMid } from "../../src/utils/biliapi";
import { logger } from "../../src/utils/logger";

interface UnpackedData {
    card?: {
        mid: string;
        res: any;
        group: string;
    };
    info?: {
        mid: string;
        res: any;
        group: string;
    };
}

function emptyObject(params?: object) {
    if (typeof params === "undefined") {
        return true;
    }
    if (Object.keys(params).length > 0) {
        return false;
    }
    return true;
}

export async function bilibiliChannelsDataset(dataset: VTuberModel[]) {
    logger.info("bilibiliChannelsDataset() fetching channels data...");
    let group = dataset[0]["id"];
    let channels: ChannelsProps[] = await ChannelsData.find({
        group: { $eq: dataset[0].id },
        platform: { $eq: "bilibili" },
    });
    let parsedChannelIds: string[] = channels.map((res) => res.id);
    // @ts-ignore
    let channelIds: BiliIDwithGroup[] = dataset.map((res) => ({
        id: res.bilibili,
        group: res.id,
    }));

    channelIds = channelIds.filter((res) => !parsedChannelIds.includes(res.id));
    if (channelIds.length < 1) {
        logger.warn(`twcastChannelsDataset(${group}) no new channels to be registered`);
        return;
    }
    logger.info(`bilibiliChannelsDataset(${group}) processing ${channelIds.length} channels`);
    const allFetchedResponses = await fetchChannelsMid(channelIds);
    logger.info(`bilibiliChannelsDataset(${group}) parsing results...`);
    let insertData = [];
    for (let i = 0; i < allFetchedResponses.length; i++) {
        const mapped_data = allFetchedResponses[i];
        let assignedData: UnpackedData = {};
        for (let i = 0; i < mapped_data.length; i++) {
            if (mapped_data[i].url.includes("card")) {
                assignedData["card"] = {
                    res: mapped_data[i].res,
                    mid: mapped_data[i].mid,
                    group: mapped_data[i].group,
                };
            } else if (mapped_data[i].url.includes("info")) {
                assignedData["info"] = {
                    res: mapped_data[i].res,
                    mid: mapped_data[i].mid,
                    group: mapped_data[i].group,
                };
            }
        }
        let mid;
        if (typeof assignedData["info"] === "undefined" && typeof assignedData["card"] === "undefined") {
            logger.error(`bilibiliChannelsDataset() got empty data for index ${i} for some reason...`);
            continue;
        } else if (typeof assignedData["info"] !== "undefined") {
            mid = assignedData["info"].mid;
        } else if (typeof assignedData["card"] !== "undefined") {
            mid = assignedData["card"].mid;
        }
        if (emptyObject(assignedData["info"]?.res) || emptyObject(assignedData["card"]?.res)) {
            logger.error(`bilibiliChannelsDataset() got empty data mid ${mid}...`);
            continue;
        }

        let infoData = assignedData["info"]?.res;
        let cardData = assignedData["card"]?.res;

        let newData = {
            id: mid,
            room_id: infoData["live_room"]["roomid"].toString(),
            name: infoData["name"],
            description: infoData["sign"],
            subscriberCount: cardData["follower"],
            viewCount: 0,
            videoCount: cardData["archive_count"],
            thumbnail: infoData["face"],
            group: group,
            is_live: infoData["live_room"]["liveStatus"] === 1 ? true : false,
            platform: "bilibili",
            is_retired: false,
        };
        insertData.push(newData);
    }

    // @ts-ignore
    let historyDatas: ChannelStatsHistProps[] = insertData.map((res) => {
        let timestamp = Math.floor(DateTime.utc().toSeconds());
        return {
            id: res["id"],
            history: [
                {
                    timestamp: timestamp,
                    subscriberCount: res["subscriberCount"],
                    videoCount: res["videoCount"],
                    viewCount: res["viewCount"],
                },
            ],
            group: res["group"],
            platform: "bilibili",
        };
    });
    if (insertData.length > 0) {
        logger.info(`bilibiliChannelsDataset(${group}) committing new data...`);
        await ChannelsData.insertMany(insertData).catch((err: any) => {
            logger.error(`bilibiliChannelsDataset(${group}) failed to insert new data, ${err.toString()}`);
        });
    }
    if (historyDatas.length > 0) {
        logger.info(`bilibiliChannelsDataset(${group}) committing new history data...`);
        await ChannelStatsHistData.insertMany(historyDatas).catch((err: any) => {
            logger.error(
                `bilibiliChannelsDataset(${group}) failed to insert new history data, ${err.toString()}`
            );
        });
    }
}
