import axios from "axios";
import _ from "lodash";
import { TWCastChannelProps, TwitcastingChannel } from "../../src/models";
import { logger } from "../../src/utils/logger";
import { isNone } from "../../src/utils/swissknife";
import { VTuberModel } from "../dataset/model";

const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.138 Safari/537.36";

export async function twcastChannelsDataset(dataset: VTuberModel[]) {
    let session = axios.create({
        headers: {
            "User-Agent": CHROME_UA
        }
    })
    let group = dataset[0]["id"];

    logger.info("twcastChannelsDataset() fetching channels data...");
    let channels: TWCastChannelProps[] = await TwitcastingChannel.find({"group": {"$eq": dataset[0].id}});
    let parsedChannelIds: string[] = channels.map(res => res.id);
    let channelIds = dataset.map(res => ({
        id: res.twitcasting,
        group: res.id,
        name: res.name,
    }));
    // @ts-ignore
    channelIds = channelIds.filter(res => !parsedChannelIds.includes(res.id));
    if (channelIds.length < 1) {
        logger.warn(`twcastChannelsDataset(${group}) no new channels to be registered`);
        return;
    }

    logger.info(`twcastChannelsDataset(${group}) creating fetch jobs...`);
    const channelPromises = channelIds.map((channel) => (
        session.get(`https://frontendapi.twitcasting.tv/users/${channel.id}`, {
            params: {
                detail: "true",
            },
            responseType: "json"
        })
        .then((jsonRes) => {
            return {"data": jsonRes.data, "group": channel.group, "en_name": channel.name};
        })
        .catch((err) => {
            logger.error(`twcastChannelsDataset(${group}) failed fetching for ${channel.id}, error: ${err.toString()}`);
            return {"data": {}, "group": channel.group, "en_name": channel.name};
        })
    ));
    logger.info(`twcastChannelsDataset(${group}) executing API requests...`);
    const collectedChannels = (await Promise.all(channelPromises)).filter(res => Object.keys(res["data"]).length > 0);
    let insertData = [];
    for (let i = 0; i < collectedChannels.length; i++) {
        let raw_res = collectedChannels[i];
        let result = raw_res["data"];
        if (!_.has(result, "user")) {
            continue;
        }

        let udata = result["user"];
        let desc = "";
        if (_.has(udata, "description") && !isNone(udata["description"]) && udata["description"] !== "") {
            desc = udata["description"]
        }
        let profile_img: string = udata["image"]
        if (profile_img.startsWith("//")) {
            profile_img = "https:" + profile_img
        }
        let mappedNew = {
            "id": udata["id"],
            "name": udata["name"],
            "en_name": raw_res["en_name"],
            "description": desc,
            "thumbnail": profile_img,
            "followerCount": udata["backerCount"],
            "level": udata["level"],
            "group": raw_res["group"],
            "platform": "twitcasting"
        }
        insertData.push(mappedNew);
    }

    if (insertData.length > 0) {
        logger.info(`twcastChannelsDataset(${group}) committing new data...`);
        await TwitcastingChannel.insertMany(insertData).catch((err) => {
            logger.error(`twcastChannelsDataset(${group}) failed to insert new data, ${err.toString()}`);
        });
    }
}