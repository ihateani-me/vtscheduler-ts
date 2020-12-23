import { TwitchChannel, TwitchVideo, TTVChannelProps, TTVVideoProps } from "../models/twitch";
import { logger } from "../utils/logger";
import _ from "lodash";
import { isNone } from "../utils/swissknife";
import moment from "moment-timezone";
import { TwitchHelix } from "../utils/twitchapi";
import { SkipRunConfig } from "../models";

export async function ttvLiveHeartbeat(ttvAPI: TwitchHelix, skipRunData: SkipRunConfig) {
    logger.info("ttvLiveHeartbeat() fetching channels and videos data...");
    let video_sets: TTVVideoProps[] = (await TwitchVideo.find({}))
                                    .filter(res => !skipRunData["groups"].includes(res.group))
                                    .filter(res => !skipRunData["channel_ids"].includes(res.channel_id));
    let channels: TTVChannelProps[] = (await TwitchChannel.find({}))
                                    .filter(res => !skipRunData["groups"].includes(res.group))
                                    .filter(res => !skipRunData["channel_ids"].includes(res.id));
    if (channels.length < 1) {
        logger.warn("ttvLiveHeartbeat() no registered channels");
        return;
    }

    let channelIds: string[] = channels.map(res => res.id);
    logger.info("ttvLiveHeartbeat() fetching to API...");
    let twitch_results: any[] = await ttvAPI.fetchLivesData(channelIds);
    logger.info("ttvLiveHeartbeat() parsing API results...");
    let insertData: any[] = [];
    let updateData: any[] = [];
    for (let i = 0; i < twitch_results.length; i++) {
        let result = twitch_results[i];

        let start_time = moment.tz(result["started_at"], "UTC").unix();
        let channel_map = _.find(channels, {"user_id": result["user_id"]});
        let thumbnail = result["thumbnail_url"];
        thumbnail = thumbnail.replace("{width}", "1280").replace("{height}", "720");

        let viewers = result["viewer_count"];
        let peakViewers = viewers;

        let timeMapping = {
            startTime: start_time,
            endTime: null,
            duration: null,
            publishedAt: result["started_at"],
        }

        let old_mappings = _.find(video_sets, {"id": result["id"]});
        if (isNone(old_mappings)) {
            let insertNew: TTVVideoProps = {
                "id": result["id"],
                "title": result["title"],
                "status": "live",
                // @ts-ignore
                "timedata": timeMapping,
                // @ts-ignore
                "channel_id": channel_map["id"],
                "channel_uuid": result["user_id"],
                "viewers": viewers,
                "peakViewers": peakViewers,
                "thumbnail": thumbnail,
                // @ts-ignore
                "group": channel_map["group"],
                "platform": "twitch"
            };
            insertData.push(insertNew);
        } else {
            peakViewers = _.get(old_mappings, "peakViewers", viewers);
            if (viewers > peakViewers) {
                peakViewers = viewers;
            }
            let updateOld: TTVVideoProps = {
                "id": result["id"],
                "title": result["title"],
                "status": "live",
                // @ts-ignore
                "timedata": timeMapping,
                "viewers": viewers,
                "peakViewers": peakViewers,
                "thumbnail": thumbnail,
            };
            updateData.push(updateOld);
        }
    }

    logger.info("ttvLiveHeartbeat() checking old data for moving it to past streams...");
    // @ts-ignore
    let oldData: TTVVideoProps[] = video_sets.map((oldRes) => {
        let updMap = _.find(updateData, {"id": oldRes["id"]});
        if (!isNone(updMap)) {
            return [];
        }
        let endTime = moment.tz("UTC").unix();
        // @ts-ignore
        let publishedAt = moment.tz(oldRes["timedata"]["startTime"] * 1000, "UTC").format();
        return {
            "id": oldRes["id"],
            "status": "past",
            "timedata": {
                "startTime": oldRes["timedata"]["startTime"],
                "endTime": endTime,
                // @ts-ignore
                "duration": endTime - oldRes["startTime"],
                "publishedAt": publishedAt,
            }
        };
    });
    // @ts-ignore
    oldData = _.flattenDeep(oldData);
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

export async function ttvChannelsStats(ttvAPI: TwitchHelix, skipRunData: SkipRunConfig) {
    logger.info("ttvChannelsStats() fetching channels data...");
    let channels: TTVChannelProps[] = (await TwitchChannel.find({}))
                                    .filter(res => !skipRunData["groups"].includes(res.group))
                                    .filter(res => !skipRunData["channel_ids"].includes(res.id));
    if (channels.length < 1) {
        logger.warn("ttvChannelsStats() no registered channels");
        return;
    }

    let channelIds: string[] = channels.map(res => res.id);
    logger.info("ttvChannelsStats() fetching to API...");
    let twitch_results: any[] = await ttvAPI.fetchChannels(channelIds);
    logger.info("ttvChannelsStats() parsing API results...");
    let updateData = [];
    let currentTimestamp = moment.tz("UTC").unix();
    for (let i = 0; i < twitch_results.length; i++) {
        let result = twitch_results[i];
        logger.info(`ttvChannelsStats() parsing and fetching followers and videos ${result["login"]}`);
        let followersData = await ttvAPI.fetchChannelFollowers(result["id"]);
        let videosData = (await ttvAPI.fetchChannelVideos(result["id"])).filter(vid => vid["viewable"] === "public");
        let historyData: any[] = [];
        let oldData = _.find(channels, {"id": result["login"]});
        if (typeof oldData !== "undefined") {
            // concat old set
            let oldHistoryData = _.get(oldData, "history", []);
            if (oldHistoryData.length === 0) {
                logger.error(`ttvChannelsStats() missing history data in old data for ID ${result["login"]}`);
            } else {
                historyData = _.concat(historyData, oldHistoryData);
            }
        }

        historyData.push({
            timestamp: currentTimestamp,
            followerCount: followersData["total"],
            viewCount: result["view_count"],
            videoCount: videosData.length,
        })
        // @ts-ignore
        let mappedUpdate: TTVChannelProps = {
            "id": result["login"],
            "name": result["display_name"],
            "description": result["description"],
            "thumbnail": result["profile_image_url"],
            "followerCount": followersData["total"],
            "viewCount": result["view_count"],
            "videoCount": videosData.length,
            "history": historyData
        }
        updateData.push(mappedUpdate);
    }

    if (updateData.length > 0) {
        logger.info("ttvChannelsStats() updating channels...");
        const dbUpdateCommit = updateData.map((new_update) => (
            // @ts-ignore
            TwitchChannel.findOneAndUpdate({"id": {"$eq": new_update.id}}, new_update, null, (err) => {
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