import _ from "lodash";
import moment from "moment-timezone";

import { logger } from "../utils/logger";
import { isNone } from "../utils/swissknife";
import { MildomAPI } from "../utils/mildomapi";
import { resolveDelayCrawlerPromises } from "../utils/crawler";

import {
    FiltersConfig,
    VideosData,
    VideoProps,
    ChannelsData,
    ChannelsProps,
    ChannelStatsHistData,
    ChannelStatsHistProps,
    ViewersData,
    HistoryMap
} from "../models";

export async function mildomLiveHeartbeat(mildomAPI: MildomAPI, filtersRun: FiltersConfig) {
    logger.info("mildomLiveHeartbeat() fetching channels and videos data...");
    let video_sets = await VideosData.filteredFind(filtersRun["exclude"], filtersRun["include"], undefined, [{"platform": {"$eq": "mildom"}}]);
    let channels = await ChannelsData.filteredFind(filtersRun["exclude"], filtersRun["include"], {"id": 1, "group": 1}, [{"platform": {"$eq": "mildom"}}]);
    if (channels.length < 1) {
        logger.warn("mildomLiveHeartbeat() no registered channels");
        return;
    }

    logger.info("mildomLiveHeartbeat() fetching to API...");
    let mildomRequest = channels.map((chan) => (
        mildomAPI.fetchLives(chan.id).then((res) => {
            if (typeof res === "undefined") {
                return {};
            }
            res["group"] = chan.group;
            return res;
        }).catch((err) => {
            logger.error(`mildomLiveHeartbeat() error occured when fetching ${chan.name}, ${err.toString()}`);
            return {};
        })
    ))
    let mildomCrawlerDelayed = resolveDelayCrawlerPromises(mildomRequest, 300);
    // @ts-ignore
    let mildom_results: MildomVideoProps[] = await Promise.all(mildomCrawlerDelayed);
    logger.info("mildomLiveHeartbeat() parsing API results...");
    let insertData: any[] = [];
    let updateData: any[] = [];
    for (let i = 0; i < mildom_results.length; i++) {
        let result = mildom_results[i];
        if (isNone(result, true)) {
            continue;
        }

        let timeMapping = {
            startTime: result["timedata"]["startTime"],
            endTime: null,
            duration: null,
            publishedAt: result["timedata"]["publishedAt"],
        }

        let viewers = result["viewers"];
        let old_mappings = _.find(video_sets, {"id": result["id"]});

        let peakViewers = _.get(old_mappings, "peakViewers", undefined);
        if (typeof peakViewers === "number" && typeof viewers === "number") {
            if (viewers > peakViewers) {
                peakViewers = viewers;
            }
        } else {
            peakViewers = viewers;
        }

        if (isNone(old_mappings)) {
            let insertNew: VideoProps = {
                "id": result["id"],
                "title": result["title"],
                "status": "live",
                // @ts-ignore
                "timedata": timeMapping,
                // @ts-ignore
                "channel_id": result["channel_id"],
                "viewers": viewers,
                "peakViewers": peakViewers,
                "thumbnail": result["thumbnail"],
                // @ts-ignore
                "group": result["group"],
                "platform": "mildom"
            };
            insertData.push(insertNew);
        } else {
            let updateOld: VideoProps = {
                "id": result["id"],
                "title": result["title"],
                "status": "live",
                // @ts-ignore
                "timedata": timeMapping,
                "viewers": viewers,
                "peakViewers": peakViewers,
                "thumbnail": result["thumbnail"],
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
                logger.error(`mildomLiveHeartbeat() Failed to update viewers data for ID ${result["id"]}, ${e.toString()}`);
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
                "group": result["group"],
                "platform": "mildom"
            }
            await ViewersData.insertMany([viewNewData]).catch((err) => {
                logger.error(`mildomLiveHeartbeat() Failed to add viewers data for ID ${result["id"]}, ${err.toString()}`);
            })
        }
    }

    logger.info("mildomLiveHeartbeat() checking old data for moving it to past streams...");
    let oldData: VideoProps[] = [];
    for (let i = 0; i < video_sets.length; i++) {
        let oldRes = video_sets[i];
        let updMap = _.find(updateData, {"id": oldRes["id"]});
        if (!isNone(updMap)) {
            continue
        }
        let endTime = moment.tz("UTC").unix();
        // @ts-ignore
        let publishedAt = _.get(oldRes, "publishedAt");

        // @ts-ignore
        let updOldData: VideoProps = {
            "id": oldRes["id"],
            "status": "past",
            "timedata": {
                "startTime": oldRes["timedata"]["startTime"],
                "endTime": endTime,
                // @ts-ignore
                "duration": endTime - oldRes["timedata"]["startTime"],
                "publishedAt": oldRes["timedata"]["publishedAt"],
            }
        };

        let collectViewersData = await ViewersData.findOne({"id": {"$eq": oldRes["id"]}, "platform": {"$eq": "mildom"}})
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
            logger.info(`mildomLiveHeartbeat() removing ${viewersIdsToDelete.length} viewers data...`);
            try {
                await ViewersData.deleteMany({"id": {"$in": viewersIdsToDelete}});
            } catch (e) {
                logger.error(`mildomLiveHeartbeat() failed to remove viewers data, ${e.toString()}`);
            }
            
        }
    }

    if (insertData.length > 0) {
        logger.info("mildomLiveHeartbeat() inserting new videos...");
        await VideosData.insertMany(insertData).catch((err) => {
            logger.error(`mildomLiveHeartbeat() failed to insert new video to database.\n${err.toString()}`);
        });
    }
    if (updateData.length > 0) {
        logger.info("mildomLiveHeartbeat() updating existing videos...");
        const dbUpdateCommit = updateData.map((new_update) => (
            VideosData.findOneAndUpdate({"id": {"$eq": new_update.id}}, new_update, null, (err) => {
                if (err) {
                    // @ts-ignore
                    logger.error(`mildomLiveHeartbeat() failed to update ${new_update.id}, ${err.toString()}`);
                    return;
                } else {
                    return;
                }
            })
        ))
        await Promise.all(dbUpdateCommit).catch((err) => {
            logger.error(`mildomLiveHeartbeat() failed to update databases, ${err.toString()}`);
        })
    }
    logger.info("mildomLiveHeartbeat() heartbeat updated!");
}

export async function mildomChannelsStats(mildomAPI: MildomAPI, filtersRun: FiltersConfig) {
    logger.info("mildomChannelStats() fetching channels data...");
    let channels = await ChannelsData.filteredFind(filtersRun["exclude"], filtersRun["include"], undefined, [{"platform": {"$eq": "mildom"}}]);
    if (channels.length < 1) {
        logger.warn("mildomChannelStats() no registered channels");
        return;
    }
    logger.info("mildomChannelsStats() fetching history data...");
    let channels_history_data = await ChannelStatsHistData.filteredFind(filtersRun["exclude"], filtersRun["include"], {
        "id": 1,
        "platform": 1,
    }, [{"platform": {"$eq": "mildom"}}]);

    logger.info("mildomChannelStats() fetching to API...");
    let mildomRequest: Promise<ChannelsProps | null>[] = channels.map((chan) => (
        mildomAPI.fetchUser(chan.id).then((res) => {
            if (typeof res === "undefined") {
                return null;
            }
            res["group"] = chan.group;
            return res;
        }).catch((err) => {
            logger.error(`mildomChannelStats() error occured when fetching ${chan.name}, ${err.toString()}`);
            return null;
        })
    ))
    let mildomCrawlerDelayed = resolveDelayCrawlerPromises(mildomRequest, 300);
    let mildom_results = await Promise.all(mildomCrawlerDelayed);
    logger.info("mildomChannelStats() parsing API results...");
    let updateData = [];
    let historySet: HistoryMap[] = [];
    let currentTimestamp = moment.tz("UTC").unix();
    for (let i = 0; i < mildom_results.length; i++) {
        let result = mildom_results[i];
        if (result === null) {
            continue;
        }
        logger.info(`mildomChannelStats() parsing and fetching followers and videos ${result["id"]}`);
        let videosData = await mildomAPI.fetchVideos(result["id"]);

        let chData = _.find(channels, {"id": result["id"]});
        let group: string;
        if (typeof chData !== "undefined") {
            group = chData["group"];
        } else {
            group = "unknown";
        }
        let oldHistory = _.find(channels_history_data, {"id": result["id"]});
        if (typeof oldHistory === "undefined") {
            historySet.push({
                id: result["id"],
                history: {
                    timestamp: currentTimestamp,
                    followerCount: result["followerCount"],
                    level: result["level"],
                    videoCount: videosData.length,
                },
                mod: "insert",
                group: group
            })
        } else {
            historySet.push({
                id: result["id"],
                history: {
                    timestamp: currentTimestamp,
                    followerCount: result["followerCount"],
                    level: result["level"],
                    videoCount: videosData.length,
                },
                mod: "update",
                group: group
            })
        }

        // @ts-ignore
        let mappedUpdate: MildomChannelProps = {
            "id": result["id"],
            "name": result["name"],
            "description": result["description"],
            "thumbnail": result["thumbnail"],
            "followerCount": result["followerCount"],
            "videoCount": videosData.length,
            "level": result["level"],
        }
        updateData.push(mappedUpdate);
    }

    if (updateData.length > 0) {
        logger.info("mildomChannelStats() updating channels...");
        const dbUpdateCommit = updateData.map((new_update) => (
            // @ts-ignore
            ChannelsData.findOneAndUpdate({"id": {"$eq": new_update.id}}, new_update, null, (err) => {
                if (err) {
                    // @ts-ignore
                    logger.error(`mildomChannelStats() failed to update ${new_update.id}, ${err.toString()}`);
                    return;
                } else {
                    return;
                }
            })
        ))
        await Promise.all(dbUpdateCommit).catch((err) => {
            logger.error(`mildomChannelStats() failed to update databases, ${err.toString()}`);
        })
    }

    // Update history data
    logger.info("mildomChannelsStats() updating/inserting channel stats!");
    let histDBUpdate = historySet.filter((o) => o.mod === "update").map((new_upd) => {
        ChannelStatsHistData.updateOne({"id": {"$eq": new_upd.id}, "platform": {"$eq": "mildom"}}, {"$addToSet": {history: new_upd["history"]}}, (err) => {
            if (err) {
                logger.error(`mildomChannelsStats() failed to update history ${new_upd.id}, ${err.toString()}`);
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
            platform: "mildom",
        }
    })

    if (insertDBUpdateList.length > 0) {
        await ChannelStatsHistData.insertMany(insertDBUpdateList).catch((err) => {
            logger.error(`mildomChannelsStats() failed to insert new history to databases, ${err.toString()}`);
        })
    }
    if (histDBUpdate.length > 0) {
        await Promise.all(histDBUpdate).catch((err) => {
            logger.error(`mildomChannelsStats() failed to update history databases, ${err.toString()}`);
        });
    }

    logger.info("mildomChannelsStats() channels stats updated!");
}