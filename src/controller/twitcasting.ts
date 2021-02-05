import _ from "lodash";
import axios from "axios";
import moment from "moment-timezone";

import { logger } from "../utils/logger";
import { fallbackNaN, isNone } from "../utils/swissknife";
import { resolveDelayCrawlerPromises } from "../utils/crawler";
import { TwitcastingAPI, TwitcastingResponse } from "../utils/twitcastingapi";

import {
    FiltersConfig,
    VideosData,
    VideoProps,
    ChannelsData,
    ChannelsProps,
    ChannelStatsHistData,
    ViewersData,
    HistoryMap
} from "../models";

const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.138 Safari/537.36";

export async function twcastLiveHeartbeat(filtersRun: FiltersConfig) {
    let session = axios.create({
        headers: {
            "User-Agent": CHROME_UA
        }
    })

    logger.info("twcastLiveHeartbeat() fetching channels and videos data...");
    let video_sets = await VideosData.filteredFind(filtersRun["exclude"], filtersRun["include"], undefined, [{"platform": {"$eq": "twitcasting"}}]);
    let channels = await ChannelsData.filteredFind(filtersRun["exclude"], filtersRun["include"], {"id": 1, "group": 1}, [{"platform": {"$eq": "twitcasting"}}]);
    if (channels.length < 1) {
        logger.warn("twcastLiveHeartbeat() no registered channels");
        return;
    }

    logger.info("twcastLiveHeartbeat() creating fetch jobs...");
    const channelPromises = channels.map((channel) => (
        session.get("https://twitcasting.tv/streamchecker.php", {
            params: {
                u: channel.id,
                v: 999
            },
            responseType: "text"
        })
        .then((textRes) => {
            return {"res": textRes.data, "id": channel.id, "group": channel.group};
        })
        .catch((err) => {
            logger.error(`twcastLiveHeartbeat() failed to status for ${channel.id}, error: ${err.toString()}`);
            return {"res": "", "id": channel.id, "group": channel.group};
        })
    ));
    const wrappedPromises = resolveDelayCrawlerPromises(channelPromises, 300);

    const collectedLives = await Promise.all(wrappedPromises);
    let insertData: any[] = [];
    let updateData: any[] = [];
    let current_time = moment.tz("UTC").unix();
    for (let i = 0; i < collectedLives.length; i++) {
        let result = collectedLives[i];
        logger.info(`twcastLiveHeartbeat() parsing ${result.id}`);
        let splitted_data = result["res"].split("\t");
        if (splitted_data.length < 1) {
            continue;
        }
        if (splitted_data[0] === "") {
            continue;
        }

        // Mapping
        // 0: Stream ID
        // 1: Stream status
        // --> 0 Public
        // --> 5 Private
        // --> 7 Private
        // 2: Comments
        // 3: Current Viewers
        // 4: Next polling duration
        // 5: Max viewers
        // 6: Time passed in seconds
        // 7: Stream title
        // 10: Continue Count?
        // 12: Time up timer
        // 19: Special code :)

        let tw_sid = splitted_data[0];
        if (tw_sid === "7") {
            continue;
        }

        let tw_time_passed = parseInt(splitted_data[6]);
        let tw_max_viewers = parseInt(splitted_data[5]);
        let tw_current_viewers = parseInt(splitted_data[3]);
        let tw_title = decodeURIComponent(splitted_data[7]);

        // original code snippets:
        // p is splitted_data position 19 a.k.a special thingy
        // var c = 1
        //     , u = 2;
        // b = [((h = parseInt(p, 10) || 0) & c) > 0, (h & u) > 0], y = b[0], g = b[1];
        //  {
        //      isNeverShowState: y,
        //      isPrivate: g,
        //  }
        let tw_special_code = parseInt(fallbackNaN(parseInt, _.nth(splitted_data, 19), NaN), 10) || 0;
        let is_private = (tw_special_code & 2) > 0;
        let tw_thumbnail_fetch = await session.get(
            `https://apiv2.twitcasting.tv/users/${result.id}/live/thumbnail`, {
                params: {
                    "size": "large",
                    "position": "beginning"
                }
            }
        )
        let tw_thumbnail = tw_thumbnail_fetch.request.res.responseUrl;
        if (tw_title === "") {
            tw_title = `Radio Live #${tw_sid}`;
        }
        let tw_start_time = Math.round(current_time - tw_time_passed);
        let publishedAt = moment.tz(tw_start_time * 1000, "UTC").format();

        let old_mappings = _.find(video_sets, {"id": tw_sid});
        if (!isNone(old_mappings)) {
            let mappedUpdate: VideoProps = {
                "id": tw_sid,
                "title": tw_title,
                "timedata": {
                    publishedAt: publishedAt,
                    startTime: tw_start_time,
                    // @ts-ignore
                    endTime: null,
                    // @ts-ignore
                    duration: null,
                },
                "is_member": is_private,
                "viewers": tw_current_viewers,
                "peakViewers": tw_max_viewers,
                "thumbnail": tw_thumbnail,
            }
            updateData.push(mappedUpdate)
        } else {
            let insertUpdate: VideoProps = {
                "id": tw_sid,
                "title": tw_title,
                "timedata": {
                    publishedAt: publishedAt,
                    startTime: tw_start_time,
                    // @ts-ignore
                    endTime: null,
                    // @ts-ignore
                    duration: null,
                },
                "status": "live",
                "viewers": tw_current_viewers,
                "peakViewers": tw_max_viewers,
                "channel_id": result["id"],
                "thumbnail": tw_thumbnail,
                "is_member": is_private,
                "group": result["group"],
                "platform": "twitcasting"
            }
            insertData.push(insertUpdate);
        }

        // checks for viewers data
        let viewersDataArrays: {
            timestamp: number;
            viewers?: number | undefined;
        }[] = [];
        let currentViewersData = await ViewersData.findOne({"id": {"$eq": tw_sid}}).then((doc) => {
            return doc;
        }).catch((err) => {
            return undefined;
        });
        if (typeof currentViewersData !== "undefined" && !_.isNull(currentViewersData)) {
            viewersDataArrays = _.get(currentViewersData, "viewersData", []);
            viewersDataArrays.push({
                timestamp: moment.tz("UTC").unix(),
                viewers: tw_current_viewers,
            });
            let viewUpdData = {
                "id": currentViewersData["id"],
                "viewersData": viewersDataArrays
            }
            try {
                await ViewersData.updateOne({"id": {"$eq": currentViewersData["id"]}}, viewUpdData);
            } catch (e) {
                logger.error(`twcastLiveHeartbeat() Failed to update viewers data for ID ${result["id"]}, ${e.toString()}`);
            }
        } else {
            viewersDataArrays.push({
                timestamp: moment.tz("UTC").unix(),
                viewers: tw_current_viewers,
            });
            let viewNewData = {
                "id": tw_sid,
                "viewersData": viewersDataArrays,
                "group": result["group"],
                "platform": "twitcasting"
            }
            await ViewersData.insertMany([viewNewData]).catch((err) => {
                logger.error(`twcastLiveHeartbeat() Failed to add viewers data for ID ${result["id"]}, ${err.toString()}`);
            })
        }
    }

    logger.info("twcastLiveHeartbeat() checking old data for moving it to past streams...");
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

        let collectViewersData = await ViewersData.findOne({"id": {"$eq": oldRes["id"]}, "platform": {"$eq": "twitcasting"}})
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
            logger.info(`twcastLiveHeartbeat() removing ${viewersIdsToDelete.length} viewers data...`);
            try {
                await ViewersData.deleteMany({"id": {"$in": viewersIdsToDelete}});
            } catch (e) {
                logger.error(`twcastLiveHeartbeat() failed to remove viewers data, ${e.toString()}`);
            }
            
        }
    }

    if (insertData.length > 0) {
        logger.info("twcastLiveHeartbeat() inserting new videos...");
        await VideosData.insertMany(insertData).catch((err) => {
            logger.error(`twcastLiveHeartbeat() failed to insert new video to database.\n${err.toString()}`);
        });
    }
    if (updateData.length > 0) {
        logger.info("twcastLiveHeartbeat() updating existing videos...");
        const dbUpdateCommit = updateData.map((new_update) => (
            VideosData.findOneAndUpdate({"id": {"$eq": new_update.id}}, new_update, null, (err) => {
                if (err) {
                    logger.error(`twcastLiveHeartbeat() failed to update ${new_update.id}, ${err.toString()}`);
                    return;
                } else {
                    return;
                }
            })
        ))
        await Promise.all(dbUpdateCommit).catch((err) => {
            logger.error(`twcastLiveHeartbeat() failed to update databases, ${err.toString()}`);
        })
    }
    logger.info("twcastLiveHeartbeat() heartbeat updated!");
}

export async function twcastChannelsStats(filtersRun: FiltersConfig) {
    let session = axios.create({
        headers: {
            "User-Agent": CHROME_UA
        }
    })

    logger.info("twcastChannelsStats() fetching channels data...");
    let channels = await ChannelsData.filteredFind(filtersRun["exclude"], filtersRun["include"], undefined, [{"platform": {"$eq": "twitcasting"}}]);
    if (channels.length < 1) {
        logger.warn("twcastChannelsStats() no registered channels");
        return;
    }
    logger.info("twcastChannelsStats() fetching history data...");
    let channels_history_data = await ChannelStatsHistData.filteredFind(filtersRun["exclude"], filtersRun["include"], {
        "id": 1,
        "platform": 1,
    }, [{"platform": {"$eq": "twitcasting"}}]);

    logger.info("twcastChannelsStats() creating fetch jobs...");
    const channelPromises = channels.map((channel) => (
        session.get(`https://frontendapi.twitcasting.tv/users/${channel.id}`, {
            params: {
                detail: "true",
            },
            responseType: "json"
        })
        .then((jsonRes) => {
            return jsonRes.data;
        })
        .catch((err) => {
            logger.error(`twcastChannelsStats() failed fetching for ${channel.id}, error: ${err.toString()}`);
            return {};
        })
    ));
    const wrappedPromises = resolveDelayCrawlerPromises(channelPromises, 300);
    logger.info("twcastChannelsStats() executing API requests...");
    const collectedChannels = (await Promise.all(wrappedPromises)).filter(res => Object.keys(res).length > 0);
    let updateData = [];
    let historySet: HistoryMap[] = [];
    let currentTimestamp = moment.tz("UTC").unix();
    for (let i = 0; i < collectedChannels.length; i++) {
        let result = collectedChannels[i];
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

        let chData = _.find(channels, {"id": udata["id"]});
        let group: string;
        if (typeof chData !== "undefined") {
            group = chData["group"];
        } else {
            group = "unknown";
        }
        let oldHistory = _.find(channels_history_data, {"id": udata["id"]});
        if (typeof oldHistory === "undefined") {
            historySet.push({
                id: udata["id"],
                history: {
                    timestamp: currentTimestamp,
                    followerCount: udata["backerCount"],
                    level: udata["level"],
                },
                mod: "insert",
                group: group
            })
        } else {
            historySet.push({
                id: udata["id"],
                history: {
                    timestamp: currentTimestamp,
                    followerCount: udata["backerCount"],
                    level: udata["level"],
                },
                mod: "update",
                group: group
            })
        }

        // @ts-ignore
        let mappedUpdate: ChannelsProps = {
            "id": udata["id"],
            "name": udata["name"],
            "description": desc,
            "thumbnail": profile_img,
            "followerCount": udata["backerCount"],
            "level": udata["level"],
        }
        updateData.push(mappedUpdate);
    }

    if (updateData.length > 0) {
        logger.info("twcastChannelsStats() updating channels...");
        const dbUpdateCommit = updateData.map((new_update) => (
            // @ts-ignore
            TwitcastingChannel.findOneAndUpdate({"id": {"$eq": new_update.id}}, new_update, null, (err) => {
                if (err) {
                    // @ts-ignore
                    logger.error(`twcastChannelsStats() failed to update ${new_update.id}, ${err.toString()}`);
                    return;
                } else {
                    return;
                }
            })
        ))
        await Promise.all(dbUpdateCommit).catch((err) => {
            logger.error(`twcastChannelsStats() failed to update databases, ${err.toString()}`);
        })
    }

    // Update history data
    logger.info("twcastChannelsStats() updating/inserting channel stats!");
    let histDBUpdate = historySet.filter((o) => o.mod === "update").map((new_upd) => {
        ChannelStatsHistData.updateOne({"id": {"$eq": new_upd.id}, "platform": {"$eq": "twitcasting"}}, {"$addToSet": {history: new_upd["history"]}}, (err) => {
            if (err) {
                logger.error(`twcastChannelsStats() failed to update history ${new_upd.id}, ${err.toString()}`);
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
            platform: "twitcasting",
        }
    })

    if (insertDBUpdateList.length > 0) {
        await ChannelStatsHistData.insertMany(insertDBUpdateList).catch((err) => {
            logger.error(`twcastChannelsStats() failed to insert new history to databases, ${err.toString()}`);
        })
    }
    if (histDBUpdate.length > 0) {
        await Promise.all(histDBUpdate).catch((err) => {
            logger.error(`twcastChannelsStats() failed to update history databases, ${err.toString()}`);
        });
    }

    logger.info("twcastChannelsStats() channels stats updated!");
}