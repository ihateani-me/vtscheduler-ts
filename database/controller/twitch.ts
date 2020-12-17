import _ from "lodash";
import { TwitchChannel, TTVChannelProps } from "../../src/models";
import { logger } from "../../src/utils/logger";
import { VTuberModel } from "../dataset/model";
import { TwitchHelix } from "../../src/utils/twitchapi";

export async function ttvChannelDataset(dataset: VTuberModel[], ttvAPI: TwitchHelix) {
    let channels: TTVChannelProps[] = await TwitchChannel.find({"group": {"$eq": dataset[0].id}});
    let parsedChannelIds: string[] = channels.map(res => res.id);
    // @ts-ignore
    let channelIds: string[] = dataset.map(res => res.twitch);
    channelIds = channelIds.filter(res => !parsedChannelIds.includes(res));
    if (channelIds.length < 1) {
        logger.warn("ttvChannelDataset() no new channels to be registered");
        return;
    }
    logger.info("ttvChannelDataset() fetching to API...");
    let twitch_results: any[] = await ttvAPI.fetchChannels(channelIds);
    logger.info("ttvChannelDataset() parsing API results...");
    let newChannels = [];
    for (let i = 0; i < twitch_results.length; i++) {
        let result = twitch_results[i];
        logger.info(`ttvChannelDataset() parsing and fetching followers and videos ${result["login"]}`);
        let followersData = await ttvAPI.fetchChannelFollowers(result["id"]);
        let videosData = (await ttvAPI.fetchChannelVideos(result["id"])).filter(vid => vid["viewable"] === "public");
        // @ts-ignore
        let channels_map: VTuberModel = _.find(dataset, {"twitch": result["login"]});
        let mappedUpdate = {
            "id": result["login"],
            "user_id": result["id"],
            "name": result["display_name"],
            "description": result["description"],
            "thumbnail": result["profile_image_url"],
            "publishedAt": result["created_at"],
            "followerCount": followersData["total"],
            "viewCount": result["view_count"],
            "videoCount": videosData.length,
            // @ts-ignore
            "group": channels_map["id"],
            "platform": "twitch",
        }
        newChannels.push(mappedUpdate);
    }

    if (newChannels.length > 0) {
        logger.info(`ttvChannelDataset() committing new data...`);
        await TwitchChannel.insertMany(newChannels).catch((err) => {
            logger.error(`ttvChannelDataset() failed to insert new data, ${err.toString()}`);
        });
    }
}