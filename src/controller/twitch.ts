import _ from "lodash";
import moment from "moment-timezone";

import { logger } from "../utils/logger";
import { isNone } from "../utils/swissknife";
import { TwitchHelix } from "../utils/twitchapi";

import {
    FiltersConfig,
    VideosData,
    VideoProps,
    ChannelsData,
    ChannelsProps,
    ChannelStatsHistData,
    ViewersData,
    HistoryMap,
} from "../models";

export async function ttvLiveHeartbeat(ttvAPI: TwitchHelix, filtersRun: FiltersConfig) {
    logger.info("ttvLiveHeartbeat() fetching channels and videos data...");
    let video_sets = await VideosData.filteredFind(filtersRun["exclude"], filtersRun["include"], undefined, [{"platform": {"$eq": "twitch"}}]);
    let channels = await ChannelsData.filteredFind(filtersRun["exclude"], filtersRun["include"], {"id": 1, "user_id": 1, "group": 1}, [{"platform": {"$eq": "twitch"}}]);
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
            let insertNew: VideoProps = {
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
            let updateOld: VideoProps = {
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

        // checks for viewers data
        let viewersDataArrays: {
            timestamp: number;
            viewers?: number | undefined;
        }[] = [];
        let currentViewersData = await ViewersData.findOne({"id": {"$eq": result["id"]}}).then((doc) => {
            return doc;
        }).catch((err) => {
            return undefined;
        });
        if (typeof currentViewersData !== "undefined" && !_.isNull(currentViewersData)) {
            viewersDataArrays = _.get(currentViewersData, "viewersData", []);
            viewersDataArrays.push({
                timestamp: moment.tz("UTC").unix(),
                viewers: viewers,
            });
            let viewUpdData = {
                "id": currentViewersData["id"],
                "viewersData": viewersDataArrays
            }
            try {
                await ViewersData.updateOne({"id": {"$eq": currentViewersData["id"]}}, viewUpdData);
            } catch (e) {
                logger.error(`ttvLiveHeartbeat() Failed to update viewers data for ID ${result["id"]}, ${e.toString()}`);
            }
        } else {
            viewersDataArrays.push({
                timestamp: moment.tz("UTC").unix(),
                viewers: viewers,
            });
            let viewNewData = {
                "id": result["id"],
                "viewersData": viewersDataArrays,
                // @ts-ignore
                "group": channel_map["group"],
                "platform": "twitch"
            }
            await ViewersData.insertMany([viewNewData]).catch((err) => {
                logger.error(`ttvLiveHeartbeat() Failed to add viewers data for ID ${result["id"]}, ${err.toString()}`);
            })
        }
    }

    logger.info("ttvLiveHeartbeat() checking old data for moving it to past streams...");
    let oldData: VideoProps[] = [];
    for (let i = 0; i < video_sets.length; i++) {
        let oldRes = video_sets[i];
        let updMap = _.find(updateData, {"id": oldRes["id"]});
        if (!isNone(updMap)) {
            continue
        }
        let endTime = moment.tz("UTC").unix();
        // @ts-ignore
        let publishedAt = moment.tz(oldRes["timedata"]["startTime"] * 1000, "UTC").format();

        // @ts-ignore
        let updOldData: VideoProps = {
            "id": oldRes["id"],
            "status": "past",
            "timedata": {
                "startTime": oldRes["timedata"]["startTime"],
                "endTime": endTime,
                // @ts-ignore
                "duration": endTime - oldRes["timedata"]["startTime"],
                "publishedAt": publishedAt,
            }
        };

        let collectViewersData = await ViewersData.findOne({"id": {"$eq": oldRes["id"]}, "platform": {"$eq": "twitch"}})
                                                    .then((doc) => {return doc})
                                                    .catch(() => {return undefined});
        if (typeof collectViewersData !== "undefined" && !_.isNull(collectViewersData)) {
            let viewersStats: any[] = _.get(collectViewersData, "viewersData", []);
            if (viewersStats.length > 0) {
                let viewersNum = _.map(viewersStats, "viewers");
                viewersNum = viewersNum.filter(v => typeof v === "number");
                let averageViewers = Math.round(_.sum(viewersNum) / viewersNum.length);
                updOldData["averageViewers"] = isNaN(averageViewers) ? 0 : averageViewers;
            }
        }
        // @ts-ignore
        oldData.push(updOldData);
    }

    updateData = _.concat(updateData, oldData);
    let dataWithAverageViewers = _.filter(updateData, (o) => _.has(o, "averageViewers"));
    if (dataWithAverageViewers.length > 0) {
        let viewersIdsToDelete = _.map(dataWithAverageViewers, "id");
        if (viewersIdsToDelete.length > 0) {
            logger.info(`ttvLiveHeartbeat() removing ${viewersIdsToDelete.length} viewers data...`);
            try {
                await ViewersData.deleteMany({"id": {"$in": viewersIdsToDelete}});
            } catch (e) {
                logger.error(`ttvLiveHeartbeat() failed to remove viewers data, ${e.toString()}`);
            }
            
        }
    }

    if (insertData.length > 0) {
        logger.info("ttvLiveHeartbeat() inserting new videos...");
        await VideosData.insertMany(insertData).catch((err) => {
            logger.error(`ttvLiveHeartbeat() failed to insert new video to database.\n${err.toString()}`);
        });
    }
    if (updateData.length > 0) {
        logger.info("ttvLiveHeartbeat() updating existing videos...");
        const dbUpdateCommit = updateData.map((new_update) => (
            VideosData.findOneAndUpdate({"id": {"$eq": new_update.id}}, new_update, null, (err) => {
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
    logger.info("ttvLiveHeartbeat() heartbeat updated!");
}

export async function ttvChannelsStats(ttvAPI: TwitchHelix, filtersRun: FiltersConfig) {
    logger.info("ttvChannelsStats() fetching channels data...");
    let channels = await ChannelsData.filteredFind(filtersRun["exclude"], filtersRun["include"], undefined, [{"platform": {"$eq": "twitch"}}]);
    if (channels.length < 1) {
        logger.warn("ttvChannelsStats() no registered channels");
        return;
    }
    logger.info("ttvChannelsStats() fetching history data...");
    let channels_history_data = await ChannelStatsHistData.filteredFind(filtersRun["exclude"], filtersRun["include"], {
        "id": 1,
        "platform": 1,
    }, [{"platform": {"$eq": "twitch"}}]);

    let channelIds: string[] = channels.map(res => res.id);
    logger.info("ttvChannelsStats() fetching to API...");
    let twitch_results: any[] = await ttvAPI.fetchChannels(channelIds);
    logger.info("ttvChannelsStats() parsing API results...");
    let updateData = [];
    let historySet: HistoryMap[] = [];
    let currentTimestamp = moment.tz("UTC").unix();
    for (let i = 0; i < twitch_results.length; i++) {
        let result = twitch_results[i];
        logger.info(`ttvChannelsStats() parsing and fetching followers and videos ${result["login"]}`);
        let followersData = await ttvAPI.fetchChannelFollowers(result["id"]);
        let videosData = (await ttvAPI.fetchChannelVideos(result["id"])).filter(vid => vid["viewable"] === "public");

        let chData = _.find(channels, {"id": result["login"]});
        let group: string;
        if (typeof chData !== "undefined") {
            group = chData["group"];
        } else {
            group = "unknown";
        }
        let oldHistory = _.find(channels_history_data, {"id": result["login"]});
        if (typeof oldHistory === "undefined") {
            historySet.push({
                id: result["login"],
                history: {
                    timestamp: currentTimestamp,
                    followerCount: followersData["total"],
                    viewCount: result["view_count"],
                    videoCount: videosData.length,
                },
                mod: "insert",
                group: group
            })
        } else {
            historySet.push({
                id: result["login"],
                history: {
                    timestamp: currentTimestamp,
                    followerCount: followersData["total"],
                    viewCount: result["view_count"],
                    videoCount: videosData.length,
                },
                mod: "update",
                group: group
            })
        }

        // @ts-ignore
        let mappedUpdate: ChannelsProps = {
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
            ChannelsData.findOneAndUpdate({"id": {"$eq": new_update.id}}, new_update, null, (err) => {
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

    // Update history data
    logger.info("ttvChannelsStats() updating/inserting channel stats!");
    let histDBUpdate = historySet.filter((o) => o.mod === "update").map((new_upd) => {
        ChannelStatsHistData.updateOne({"id": {"$eq": new_upd.id}, "platform": {"$eq": "twitch"}}, {"$addToSet": {history: new_upd["history"]}}, (err) => {
            if (err) {
                logger.error(`ttvChannelsStats() failed to update history ${new_upd.id}, ${err.toString()}`);
            } else {
                return;
            }
        })
    });
    let insertDBUpdateList = historySet.filter((o) => o.mod === "insert").map((peta) => {
        return {
            id: peta["id"],
            history: [peta["history"]],
            group: peta["group"],
            platform: "twitch",
        }
    })

    if (insertDBUpdateList.length > 0) {
        await ChannelStatsHistData.insertMany(insertDBUpdateList).catch((err) => {
            logger.error(`ttvChannelsStats() failed to insert new history to databases, ${err.toString()}`);
        })
    }
    if (histDBUpdate.length > 0) {
        await Promise.all(histDBUpdate).catch((err) => {
            logger.error(`ttvChannelsStats() failed to update history databases, ${err.toString()}`);
        });
    }

    logger.info("ttvChannelsStats() channels stats updated!");
}