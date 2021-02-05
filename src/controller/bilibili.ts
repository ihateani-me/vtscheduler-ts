import _ from "lodash";
import axios from "axios";
import moment from "moment-timezone";

import { logger } from "../utils/logger";
import { isNone } from "../utils/swissknife";
import { resolveDelayCrawlerPromises } from "../utils/crawler";
import { BiliIDwithGroup, fetchChannelsMid } from "../utils/biliapi";

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

const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.138 Safari/537.36";

interface UnpackedData {
    card?: {
        mid: string;
        res: any;
        group: string;
    }
    info?: {
        mid: string;
        res: any;
        group: string;
    }
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

export async function bilibiliVideoFeeds(filtersRun: FiltersConfig) {
    let session = axios.create({
        headers: {
            "User-Agent": CHROME_UA
        }
    })

    logger.info("bilibiliVideoFeeds() fetching channels data...");
    let channels: ChannelsProps[] = await ChannelsData.filteredFind(filtersRun["exclude"], filtersRun["include"], {
        "id": 1,
        "group": 1,
    }, [
        {"platform": {"$eq": "bilibili"}}
    ]);
    if (channels.length < 1) {
        logger.warn("bilibiliVideoFeeds() no registered channels");
        return;
    }

    let currentTime = moment.tz("Asia/Taipei")
    let currentYearMonth = currentTime.format("YYYY-MM");
    let currentDay = currentTime.date();

    const channelsChunks = _.chunk(channels, 50);
    logger.info(`bilibiliVideoFeeds() creating fetch jobs for ${channelsChunks.length} chunks...`);
    const channelPromises = channelsChunks.map((channel, chunk) => (
        session.get("https://api.live.bilibili.com/xlive/web-ucenter/v2/calendar/GetProgramList", {
            params: {
                "type": "3",
                "year_month": currentYearMonth,
                "ruids": _.join(_.map(channel, "id"), ","),
            }
        })
        .then((res) => {
            return res.data;
        })
        .catch((err) => {
            logger.error(`bilibiliVideoFeeds() failed to fetch chunk ${chunk}, ${err.toString()}`);
            return [];
        })
    ));

    const wrappedInDelay = resolveDelayCrawlerPromises(channelPromises, 500);
    let fetchedResults = await Promise.all(wrappedInDelay).catch((err) => {
        logger.error("bilibiliVideoFeeds() failed to get all chunks!");
        return undefined;
    });
    if (typeof fetchedResults === "undefined") {
        return;
    }
    fetchedResults = _.flattenDeep(fetchedResults);

    if (fetchedResults.length < 1) {
        logger.warn("bilibiliVideoFeeds() no new video to be added.");
        return;
    }
    logger.info("bilibiliVideoFeeds() parsing new videos...");
    let insertData: VideoProps[] = [];
    for (let i = 0; i < fetchedResults.length; i++) {
        let dataChunk = fetchedResults[i]["data"];
        let programInfo = dataChunk["program_infos"];
        let processDate = Object.keys(programInfo);
        processDate = processDate.filter(res => parseInt(res) >= currentDay);
        let currentUTC = moment.tz("UTC").unix();
        for (let j = 0; j < processDate.length; j++) {
            let programDate = processDate[j];
            let programSets = programInfo[programDate];
            for (let k = 0; k < programSets.length; k++) {
                let program = programSets[k];
                if (currentUTC >= program["start_time"]) {
                    continue;
                }
                let channelMap = _.find(channels, {"id": program["ruid"].toString()});
                if (typeof channelMap === "undefined") {
                    logger.error(`bilibiliVideoFeeds() unexpected missing channel ${program["ruid"]} mapping while fetching video feeds`);
                    continue;
                }
                let genUUID = `bili${program["subscription_id"]}_${program["program_id"]}`;
                let newVideo: VideoProps = {
                    id: genUUID,
                    room_id: program["room_id"].toString(),
                    title: program["title"],
                    status: "upcoming",
                    channel_id: program["ruid"].toString(),
                    timedata: {
                        startTime: program["start_time"],
                        // @ts-ignore
                        endTime: null,
                    },
                    // @ts-ignore
                    endTime: null,
                    // @ts-ignore
                    viewers: null,
                    // @ts-ignore
                    peakViewers: null,
                    // @ts-ignore
                    thumbnail: "https://p.ihateani.me/",
                    group: channelMap["group"],
                    platform: "bilibili"
                }
                insertData.push(newVideo);
            }
        }
    }

    if (insertData.length > 0) {
        logger.info(`bilibiliVideoFeeds() inserting new videos to databases.`)
        await VideosData.insertMany(insertData).catch((err) => {
            logger.error(`bilibiliVideoFeeds() failed to insert to database.\n${err.toString()}`);
        });
    }

    logger.info("bilibiliVideoFeeds() feeds updated!");
}

export async function bilibiliLiveHeartbeat(filtersRun: FiltersConfig) {
    let session = axios.create({
        headers: {
            "User-Agent": CHROME_UA
        }
    })

    let requestConfig: any[] = [];
    if (filtersRun["exclude"]["groups"].length > 0) {
        requestConfig.push({
            "group": {"$nin": filtersRun["exclude"]["groups"]}
        });
    }
    if (filtersRun["include"]["groups"].length > 0) {
        requestConfig.push({
            "group": {"$in": filtersRun["include"]["groups"]}
        });
    }
    if (filtersRun["exclude"]["channel_ids"].length > 0) {
        requestConfig.push({
            "id": {"$nin": filtersRun["exclude"]["channel_ids"]}
        });
    }
    if (filtersRun["include"]["channel_ids"].length > 0) {
        requestConfig.push({
            "id": {"$in": filtersRun["include"]["channel_ids"]}
        });
    }

    let findReq: any = {};
    if (requestConfig.length > 0) {
        findReq["$and"] = requestConfig;
    }

    logger.info("twcastLiveHeartbeat() fetching channels and videos data...");
    let video_sets = await VideosData.filteredFind(filtersRun["exclude"], filtersRun["include"], undefined, [{"platform": {"$eq": "bilibili"}}]);
    let channels = await ChannelsData.filteredFind(filtersRun["exclude"], filtersRun["include"], {"id": 1, "room_id": 1, "group": 1}, [{"platform": {"$eq": "bilibili"}}]);
    if (channels.length < 1) {
        logger.warn("bilibiliLiveHeartbeat() no registered channels");
        return;
    }

    logger.info("bilibiliLiveHeartbeat() creating fetch jobs...");
    const channelPromises = channels.map((channel) => (
        session.get("https://api.live.bilibili.com/room/v1/Room/get_info", {
            params: {
                room_id: channel.room_id,
            },
            responseType: "json"
        })
        .then((itemsData) => {
            if (itemsData.status !== 200) {
                return {"data": {}, "group": channel["group"], "room_id": channel["room_id"]};
            }
            return {"data": itemsData["data"], "group": channel["group"], "room_id": channel["room_id"]};
        })
        .catch((err) => {
            logger.error(`twcastLiveHeartbeat() failed to status for ${channel.id}, error: ${err.toString()}`);
            return {"data": {}, "group": channel["group"], "room_id": channel["room_id"]};
        })
    ));

    const wrapInDelay = resolveDelayCrawlerPromises(channelPromises, 500);

    logger.info(`bilibiliLiveHeartbeat() executing ${wrapInDelay.length} jobs...`);
    const fetchedResults = await Promise.all(wrapInDelay);
    logger.info("bilibiliLiveHeartbeat() parsing API results...");
    let insertData: any[] = [];
    let updateData: any[] = [];
    for (let i = 0; i < fetchedResults.length; i++) {
        let rawResults = fetchedResults[i];
        let room_data = rawResults["data"];
        let group = rawResults["group"];
        let room_id = rawResults["room_id"];

        if (Object.keys(room_data).length < 1) {
            continue;
        }
        if (room_data["live_status"] !== 1) {
            continue;
        }

        let thumbnail = room_data["user_cover"];
        let viewers = room_data["online"];
        let start_time = moment.tz(room_data["live_time"], "Asia/Taipei").unix();
        let generate_id = `bili${room_id}_${start_time}`;
        let old_mappings = _.find(video_sets, {"id": generate_id});
        if (!isNone(old_mappings)) {
            let updData = {
                "id": generate_id,
                "title": room_data["title"],
                "startTime": start_time,
                "endTime": null,
                "viewers": viewers,
                "peakViewers": viewers,
                "status": "live",
                "thumbnail": thumbnail
            }
            updateData.push(updData);
        } else {
            let newData = {
                "id": generate_id,
                "room_id": room_id,
                "title": room_data["title"],
                "startTime": start_time,
                "endTime": null,
                "viewers": viewers,
                "peakViewers": viewers,
                "status": "live",
                "channel_id": "",
                "thumbnail": thumbnail,
                "group": group,
                "platform": "bilibili"
            }
            insertData.push(newData);
        }
    }

    logger.info("bilibiliLiveHeartbeat() checking old data for moving it to past streams...");
    // @ts-ignore
    let oldData: VideoProps[] = video_sets.map((oldRes) => {
        let updMap = _.find(updateData, {"id": oldRes["id"]});
        if (!isNone(updMap)) {
            return [];
        }
        let endTime = moment.tz("UTC").unix();
        let duration = endTime - updMap["timedata"]["startTime"];
        return {
            "id": oldRes["id"],
            "status": "past",
            "timedata": {
                "startTime": updMap["timedata"]["startTime"],
                "endTime": endTime,
                "duration": duration,
            },
            
        };
    });
    // @ts-ignore
    oldData = _.flattenDeep(oldData);
    updateData = _.concat(updateData, oldData);

    if (insertData.length > 0) {
        logger.info("bilibiliLiveHeartbeat() inserting new videos...");
        await VideosData.insertMany(insertData).catch((err) => {
            logger.error(`bilibiliLiveHeartbeat() failed to insert new video to database.\n${err.toString()}`);
        });
    }
    if (updateData.length > 0) {
        logger.info("bilibiliLiveHeartbeat() updating existing videos...");
        const dbUpdateCommit = updateData.map((new_update) => (
            VideosData.findOneAndUpdate({"id": {"$eq": new_update.id}}, new_update, null, (err) => {
                if (err) {
                    // @ts-ignore
                    logger.error(`bilibiliLiveHeartbeat() failed to update ${new_update.id}, ${err.toString()}`);
                    return;
                } else {
                    return;
                }
            })
        ))
        await Promise.all(dbUpdateCommit).catch((err) => {
            logger.error(`bilibiliLiveHeartbeat() failed to update databases, ${err.toString()}`);
        })
    }

    logger.info("bilibiliLiveHeartbeat() heartbeat updated!");
}

export async function bilibiliChannelsStats(filtersRun: FiltersConfig) {
    logger.info("bilibiliChannelsStats() fetching channels data...");
    let channels = await ChannelsData.filteredFind(filtersRun["exclude"], filtersRun["include"], undefined, [{"platform": {"$eq": "bilibili"}}]);
    if (channels.length < 1) {
        logger.warn("bilibiliChannelsStats() no registered channels");
        return;
    }
    logger.info("bilibiliChannelsStats() fetching history data...");
    let channels_history_data = await ChannelStatsHistData.filteredFind(filtersRun["exclude"], filtersRun["include"], {
        "id": 1,
        "platform": 1,
    }, [{"platform": {"$eq": "mildom"}}]);

    logger.info(`bilibiliChannelsStats() processing ${channels.length} channels`);
    const mapIdAndGroup: BiliIDwithGroup[] = channels.map((res) => {
        return {
            id: res["id"],
            group: res["group"],
        }
    })
    const allFetchedResponses = await fetchChannelsMid(mapIdAndGroup);
    logger.info("bilibiliChannelsStats() parsing results...");
    let updateData = [];
    let historySet: HistoryMap[] = [];
    let currentTimestamp = moment.tz("UTC").unix();
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
                }
            }
        }
        let mid;
        if (typeof assignedData["info"] === "undefined" && typeof assignedData["card"] === "undefined") {
            logger.error(`bilibiliChannelsStats() got empty data for index ${i} for some reason...`);
            continue;
        } else if (typeof assignedData["info"] !== "undefined") {
            mid = assignedData["info"].mid;
        } else if (typeof assignedData["card"] !== "undefined") {
            mid = assignedData["card"].mid;
        }
        if (emptyObject(assignedData["info"]?.res) || emptyObject(assignedData["card"]?.res)) {
            logger.error(`bilibiliChannelsStats() got empty data mid ${mid}...`);
            continue;
        }

        let infoData = _.get(_.get(assignedData, "info", {}), "res", {});
        let cardData = _.get(_.get(assignedData, "card", {}), "res", {});

        let chData = _.find(channels, {"id": mid});
        let group: string;
        if (typeof chData !== "undefined") {
            group = chData["group"];
        } else {
            group = "unknown";
        }
        let oldHistory = _.find(channels_history_data, {"id": mid});
        if (typeof oldHistory === "undefined") {
            historySet.push({
                // @ts-ignore
                id: mid,
                history: {
                    timestamp: currentTimestamp,
                    subscriberCount: cardData["follower"],
                    videoCount: cardData["archive_count"],
                },
                mod: "insert",
                group: group
            })
        } else {
            historySet.push({
                // @ts-ignore
                id: mid,
                history: {
                    timestamp: currentTimestamp,
                    subscriberCount: cardData["follower"],
                    videoCount: cardData["archive_count"],
                },
                mod: "update",
                group: group
            })
        }

        let updatedData = {
            "id": mid,
            "room_id": infoData["live_room"]["roomid"],
            "name": infoData["name"],
            "description": infoData["sign"],
            "subscriberCount": cardData["follower"],
            "videoCount": cardData["archive_count"],
            "thumbnail": infoData["face"],
            "is_live": infoData["live_room"]["liveStatus"] === 1 ? true : false,
        }
        updateData.push(updatedData);
    }

    if (updateData.length > 0) {
        logger.info("bilibiliChannelsStats() updating channels...");
        const dbUpdateCommit = updateData.map((new_update) => (
            // @ts-ignore
            BilibiliChannel.findOneAndUpdate({"id": {"$eq": new_update.id}}, new_update, null, (err) => {
                if (err) {
                    // @ts-ignore
                    logger.error(`bilibiliChannelsStats() failed to update ${new_update.id}, ${err.toString()}`);
                    return;
                } else {
                    return;
                }
            })
        ))
        await Promise.all(dbUpdateCommit).catch((err) => {
            logger.error(`bilibiliChannelsStats() failed to update databases, ${err.toString()}`);
        })
    }

    // Update history data
    logger.info("bilibiliChannelsStats() updating/inserting channel stats!");
    let histDBUpdate = historySet.filter((o) => o.mod === "update").map((new_upd) => {
        ChannelStatsHistData.updateOne({"id": {"$eq": new_upd.id}, "platform": {"$eq": "bilibili"}}, {"$addToSet": {history: new_upd["history"]}}, (err) => {
            if (err) {
                logger.error(`bilibiliChannelsStats() failed to update history ${new_upd.id}, ${err.toString()}`);
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
            platform: "bilibili",
        }
    })

    if (insertDBUpdateList.length > 1) {
        await ChannelStatsHistData.insertMany(insertDBUpdateList).catch((err) => {
            logger.error(`bilibiliChannelsStats() failed to insert new history to databases, ${err.toString()}`);
        })
    }
    if (histDBUpdate.length > 1) {
        await Promise.all(histDBUpdate).catch((err) => {
            logger.error(`bilibiliChannelsStats() failed to update history databases, ${err.toString()}`);
        });
    }

    logger.info("bilibiliChannelsStats() channels stats updated!");
}