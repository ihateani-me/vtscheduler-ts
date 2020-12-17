import { TwitchChannel, TwitchVideo, TTVChannelProps, TTVVideoProps } from "../models/twitch";
import { logger } from "../utils/logger";
import mongoose from 'mongoose';
import _ from "lodash";
import { isNone } from "../utils/swissknife";
import moment from "moment-timezone";
import config from "../config.json";
import { TwitchHelix } from "../utils/twitchapi";

let mongouri = config.mongodb.uri;
if (mongouri.endsWith("/")) {
    mongouri = mongouri.slice(0, -1);
}

mongoose.connect(`${mongouri}/${config.mongodb.dbname}`, {useNewUrlParser: true, useUnifiedTopology: true});

export async function ttvLiveHeartbeat(ttvAPI: TwitchHelix) {
    logger.info("ttvLiveHeartbeat() fetching channels and videos data...");
    let video_sets: TTVVideoProps[] = await TwitchVideo.find({});
    let channels: TTVChannelProps[] = await TwitchChannel.find({});
    if (channels.length < 1) {
        logger.warn("ttvLiveHeartbeat() no registered channels");
        return;
    }

    let channelIds: string[] = channels.map(res => res.id);
    logger.info("ttvLiveHeartbeat() fetching to API...");
    let twitch_results: any[] = await ttvAPI.fetchLivesData(channelIds);
    logger.info("ttvLiveHeartbeat() parsing API results...");
    let updateData = twitch_results.map((result) => {
        if (_.has(result, "type") && result["type"] === "") {
            logger.warn(`ttvLiveHeartbeat() skipping ${result['user_name']}`);
            return [];
        }

        let start_time = moment.tz(result["started_at"], "UTC").unix();
        let old_mappings = _.find(video_sets, {"id": result["id"]});
        if (isNone(old_mappings)) {
            return [];
        }

        let viewers = result["viewer_count"];
        let peakViewers = _.get(old_mappings, "peakViewers", viewers);
        if (viewers > peakViewers) {
            peakViewers = viewers;
        }
        return {
            "id": result["id"],
            "title": result["title"],
            "status": "live",
            "startTime": start_time,
            "endTime": null,
            "viewers": viewers,
            "peakViewers": peakViewers,
        };
    })

    let insertData = twitch_results.map((result) => {
        if (_.has(result, "type") && result["type"] === "") {
            logger.warn(`ttvLiveHeartbeat() skipping ${result['user_name']}`);
            return [];
        }

        let start_time = moment.tz(result["started_at"], "UTC").unix();
        let channel_map = _.find(channels, {"user_id": result["user_id"]});
        let thumbnail = result["thumbnail_url"];
        thumbnail = thumbnail.replace("{width}", "1280").replace("{height}", "720");

        let viewers = result["viewer_count"];
        let peakViewers = viewers;
        return {
            "id": result["id"],
            "title": result["title"],
            "status": "live",
            "startTime": start_time,
            "endTime": null,
            // @ts-ignore
            "channel_id": channel_map["id"],
            "channel_uuid": result["user_id"],
            "viewers": viewers,
            "peakViewers": peakViewers,
            "thumbnai": thumbnail,
            // @ts-ignore
            "group": channel_map["group"],
            "platform": "twitch"
        };
    })
    // @ts-ignore
    updateData = _.flattenDeep(updateData);
    // @ts-ignore
    insertData = _.flattenDeep(insertData);

    logger.info("ttvLiveHeartbeat() checking old data for moving it to past streams...");
    let oldData = video_sets.map((oldRes) => {
        let updMap = _.find(updateData, {"id": oldRes["id"]});
        if (!isNone(updMap)) {
            return [];
        }
        return {
            "id": oldRes["id"],
            "status": "past",
            "startTime": oldRes["startTime"],
            "endTime": moment.tz("UTC").unix(),
        };

    });
    // @ts-ignore
    oldData = _.flattenDeep(oldData);
    // @ts-ignore
    updateData = _.concat(updateData, oldData);

    if (insertData.length > 0) {
        logger.info("ttvLiveHeartbeat() inserting new videos...");
        await TwitchVideo.insertMany(insertData).catch((err) => {
            logger.error(`ttvLiveHeartbeat() failed to insert new video to database.\n${err.toString()}`);
        });
    }
    if (updateData.length > 0) {
        logger.info("ttvLiveHeartbeat() updating existing videos...");
        const dbUpdateCommit = updateData.map((new_update) => (
            // @ts-ignore
            TwitchVideo.findOneAndUpdate({"id": {"$eq": new_update.id}}, new_update, null, (err) => {
                if (err) {
                    // @ts-ignore
                    logger.error(`ttvLiveHeartbeat() failed to update ${new_update.id}, ${err.toString()}`);
                    return;
                } else {
                    return;
                }
            })
        ))
        await Promise.all(dbUpdateCommit).catch((err) => {
            logger.error(`ttvLiveHeartbeat() failed to update databases, ${err.toString()}`);
        })
    }
}

export async function ttvChannelsStats(ttvAPI: TwitchHelix) {
    logger.info("ttvChannelsStats() fetching channels data...");
    let channels: TTVChannelProps[] = await TwitchChannel.find({});
    if (channels.length < 1) {
        logger.warn("ttvChannelsStats() no registered channels");
        return;
    }

    let channelIds: string[] = channels.map(res => res.id);
    logger.info("ttvChannelsStats() fetching to API...");
    let twitch_results: any[] = await ttvAPI.fetchChannels(channelIds);
    logger.info("ttvChannelsStats() parsing API results...");
    let updateData = [];
    for (let i = 0; i < twitch_results.length; i++) {
        let result = twitch_results[i];
        logger.info(`ttvChannelsStats() parsing and fetching followers and videos ${result["login"]}`);
        let followersData = await ttvAPI.fetchChannelFollowers(result["id"]);
        let videosData = (await ttvAPI.fetchChannelVideos(result["id"])).filter(vid => vid["viewable"] === "public");
        let mappedUpdate = {
            "id": result["login"],
            "name": result["display_name"],
            "description": result["description"],
            "thumbnail": result["profile_image_url"],
            "followerCount": followersData["total"],
            "viewCount": result["view_count"],
            "videoCount": videosData.length,
        }
        updateData.push(mappedUpdate);
    }

    if (updateData.length > 0) {
        logger.info("ttvChannelsStats() updating channels...");
        const dbUpdateCommit = updateData.map((new_update) => (
            // @ts-ignore
            TwitchVideo.findOneAndUpdate({"id": {"$eq": new_update.id}}, new_update, null, (err) => {
                if (err) {
                    // @ts-ignore
                    logger.error(`ttvChannelsStats() failed to update ${new_update.id}, ${err.toString()}`);
                    return;
                } else {
                    return;
                }
            })
        ))
        await Promise.all(dbUpdateCommit).catch((err) => {
            logger.error(`ttvChannelsStats() failed to update databases, ${err.toString()}`);
        })
    }
}