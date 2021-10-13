import _ from "lodash";
import { DateTime } from "luxon";

import { VTuberModel } from "../dataset/model";

import { ChannelsData, ChannelsProps, ChannelStatsHistData, ChannelStatsHistProps } from "../../src/models";
import { logger } from "../../src/utils/logger";
import { TwitterAPI } from "../../src/utils/twspaces";
import { isNone } from "../../src/utils/swissknife";

function bestProfilePicture(url: string): string {
    if (isNone(url)) {
        return "";
    }
    // remove anything after the picture ID.
    // format: https://pbs.twimg.com/profile_images/xxxxxxxxxxxxx/pictureId_whatever.jpg
    const splitIdx = url.lastIndexOf("_");
    if (splitIdx < 40) {
        return url;
    }
    const extIdx = url.lastIndexOf(".");
    const firstPart = url.substring(0, splitIdx);
    const extension = url.substring(extIdx);
    return firstPart + extension;
}

export async function twitterChannelDataset(dataset: VTuberModel[], twtAPI: TwitterAPI) {
    logger.info("twitterChannelDataset() fetching channels data...");
    let group = dataset[0]["id"];
    let channels: ChannelsProps[] = await ChannelsData.find({
        group: { $eq: group },
        platform: { $eq: "twitter" },
    });
    let parsedChannelIds: string[] = channels.map((res) => res.id);
    // @ts-ignore
    let channelIds: string[] = dataset.map((res) => res.twitter);
    channelIds = channelIds.filter((res) => !parsedChannelIds.includes(res));
    if (channelIds.length < 1) {
        logger.warn(`twitterChannelDataset(${group}) no new channels to be registered`);
        return;
    }

    logger.info("twitterChannelDataset() fetching to API...");
    const twitterResutls = await twtAPI.fetchUserIdFromUsername(channelIds);
    logger.info("twitterChannelDataset() parsing API results...");

    const newChannels: ChannelsProps[] = [];
    for (let i = 0; i < twitterResutls.length; i++) {
        const result = twitterResutls[i];
        const followersData = _.get(result, "public_metrics.followers_count", 0) as number;
        const channelsMap = _.find(dataset, { twitter: result.username });
        // @ts-ignore
        const mappedUpdate: ChannelsProps = {
            id: result.username,
            user_id: result.id,
            name: result.name,
            en_name: channelsMap?.name,
            description: result.description,
            publishedAt: result.created_at,
            followerCount: followersData,
            thumbnail: bestProfilePicture(result.profile_image_url),
            group: group,
            platform: "twitter",
            is_retired: false,
        }
        newChannels.push(mappedUpdate);
    }

    const currentTimestamp = Math.floor(DateTime.utc().toSeconds());
    // @ts-ignore
    let historyDatas: ChannelStatsHistProps[] = newChannels.map((res) => {
        return {
            id: res.user_id,
            history: [
                {
                    timestamp: currentTimestamp,
                    followerCount: res.followerCount,
                },
            ],
            group: res.group,
            platform: "twitter",
        };
    });

    if (newChannels.length > 0) {
        logger.info(`twitterChannelDataset(${group}) committing new data...`);
        await ChannelsData.insertMany(newChannels).catch((err: any) => {
            logger.error(`twitterChannelDataset(${group}) failed to insert new data, ${err.toString()}`);
        });
    }
    if (historyDatas.length > 0) {
        logger.info(`twitterChannelDataset(${group}) committing new history data...`);
        await ChannelStatsHistData.insertMany(historyDatas).catch((err: any) => {
            logger.error(`twitterChannelDataset(${group}) failed to insert new history data, ${err.toString()}`);
        });
    }
    logger.info(`twitterChannelDataset(${group}) task finished!`);
}