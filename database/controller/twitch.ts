import _ from "lodash";
import { DateTime } from "luxon";

import { VTuberModel } from "../dataset/model";

import { ChannelsData, ChannelsProps, ChannelStatsHistData, ChannelStatsHistProps } from "../../src/models";
import { logger } from "../../src/utils/logger";
import { TwitchHelix } from "../../src/utils/twitchapi";

export async function ttvChannelDataset(dataset: VTuberModel[], ttvAPI: TwitchHelix) {
    let group = dataset[0]["id"];
    let channels: ChannelsProps[] = await ChannelsData.find({
        group: { $eq: dataset[0].id },
        platform: { $eq: "twitch" },
    });
    let parsedChannelIds: string[] = channels.map((res) => res.id);
    // @ts-ignore
    let channelIds: string[] = dataset.map((res) => res.twitch);
    channelIds = channelIds.filter((res) => !parsedChannelIds.includes(res));
    if (channelIds.length < 1) {
        logger.warn(`ttvChannelDataset(${group}) no new channels to be registered`);
        return;
    }
    logger.info(`ttvChannelDataset(${group}) fetching to API...`);
    let twitch_results: any[] = await ttvAPI.fetchChannels(channelIds);
    logger.info(`ttvChannelDataset(${group}) parsing API results...`);
    let newChannels: ChannelsProps[] = [];
    for (let i = 0; i < twitch_results.length; i++) {
        let result = twitch_results[i];
        logger.info(
            `ttvChannelDataset(${group}) parsing and fetching followers and videos ${result["login"]}`
        );
        let followersData = await ttvAPI.fetchChannelFollowers(result["id"]).catch((err) => {
            logger.error(`ttvChannelDataset(${group}) failed to fetch follower list for: ${result["login"]}`);
            return { total: 0 };
        });
        let videosData = (
            await ttvAPI.fetchChannelVideos(result["id"]).catch((err) => {
                logger.error(
                    `ttvChannelDataset(${group}) failed to fetch video list for: ${result["login"]}`
                );
                return [{ viewable: "private" }];
            })
        ).filter((vid) => vid["viewable"] === "public");
        // @ts-ignore
        let channels_map: VTuberModel = _.find(dataset, { twitch: result["login"] });
        // @ts-ignore
        let mappedUpdate: ChannelsProps = {
            id: result["login"],
            user_id: result["id"],
            name: result["display_name"],
            // @ts-ignore
            en_name: channels_map["name"],
            description: result["description"],
            thumbnail: result["profile_image_url"],
            publishedAt: result["created_at"],
            followerCount: followersData["total"],
            viewCount: result["view_count"],
            videoCount: videosData.length,
            // @ts-ignore
            group: channels_map["id"],
            platform: "twitch",
            is_retired: false,
        };
        newChannels.push(mappedUpdate);
    }

    // @ts-ignore
    let historyDatas: ChannelStatsHistProps[] = newChannels.map((res) => {
        let timestamp = Math.floor(DateTime.utc().toSeconds());
        return {
            id: res["id"],
            history: [
                {
                    timestamp: timestamp,
                    followerCount: res["followerCount"],
                    viewCount: res["viewCount"],
                    videoCount: res["videoCount"],
                },
            ],
            group: res["group"],
            platform: "twitch",
        };
    });

    if (newChannels.length > 0) {
        logger.info(`ttvChannelDataset(${group}) committing new data...`);
        await ChannelsData.insertMany(newChannels).catch((err) => {
            logger.error(`ttvChannelDataset(${group}) failed to insert new data, ${err.toString()}`);
        });
    }
    if (historyDatas.length > 0) {
        logger.info(`ttvChannelDataset(${group}) committing new history data...`);
        await ChannelStatsHistData.insertMany(historyDatas).catch((err) => {
            logger.error(`ttvChannelDataset(${group}) failed to insert new history data, ${err.toString()}`);
        });
    }
}
