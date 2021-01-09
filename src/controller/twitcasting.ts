import axios from "axios";
import { TwitcastingChannel, TwitcastingVideo, TWCastChannelProps, TWCastVideoProps } from "../models/twitcasting";
import { logger } from "../utils/logger";
import _ from "lodash";
import { fallbackNaN, isNone } from "../utils/swissknife";
import moment from "moment-timezone";
import { FiltersConfig } from "../models";
import { resolveDelayCrawlerPromises } from "../utils/crawler";
import { ViewersData } from "../models/extras";
import { TwitcastingAPI, TwitcastingResponse } from "../utils/twitcastingapi";

const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.138 Safari/537.36";

export async function twcastLiveHeartbeat(filtersRun: FiltersConfig) {
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
    let video_sets: TWCastVideoProps[] = (await TwitcastingVideo.find(findReq));
    let channels: TWCastChannelProps[] = (await TwitcastingChannel.find(findReq));
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
    const wrappedPromises: Promise<{
        res: any;
        id: string;
        group: string;
    } | {
        res: string;
        id: string;
        group: string;
    }>[] = resolveDelayCrawlerPromises(channelPromises, 300);

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
            let mappedUpdate: TWCastVideoProps = {
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
            let insertUpdate: TWCastVideoProps = {
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
    let oldData: TWCastVideoProps[] = [];
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
        let updOldData: TWCastVideoProps = {
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
        await TwitcastingVideo.insertMany(insertData).catch((err) => {
            logger.error(`twcastLiveHeartbeat() failed to insert new video to database.\n${err.toString()}`);
        });
    }
    if (updateData.length > 0) {
        logger.info("twcastLiveHeartbeat() updating existing videos...");
        const dbUpdateCommit = updateData.map((new_update) => (
            TwitcastingVideo.findOneAndUpdate({"id": {"$eq": new_update.id}}, new_update, null, (err) => {
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
}

// TODO: replace this alltogether
export async function twcastLiveHeartbeatv2(filtersRun: FiltersConfig) {
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
    let video_sets: TWCastVideoProps[] = (await TwitcastingVideo.find(findReq));
    let channels: TWCastChannelProps[] = (await TwitcastingChannel.find(findReq));
    if (channels.length < 1) {
        logger.warn("twcastLiveHeartbeat() no registered channels");
        return;
    }

    logger.info("twcastLiveHeartbeat() creating fetch jobs...");
    const channelPromises = channels.map((channel) => (
        TwitcastingAPI.getLivesInfo(channel["id"], channel["group"])
            .then((resp) => {
                return resp;
            }).catch((resp) => {
                logger.error(`twcastLiveHeartbeat() failed to fetch ${channel["id"]} live data, ${resp.toString()}`);
                const defaults: TwitcastingResponse = {is_live: false, channel_id: channel.id, group: channel.group};
                return defaults;
            })
    ));
    const wrappedPromises: Promise<TwitcastingResponse>[] = resolveDelayCrawlerPromises(channelPromises, 300);

    const collectedLives = await Promise.all(wrappedPromises);
    let insertData: any[] = [];
    let updateData: any[] = [];
    // let current_time = moment.tz("UTC").unix();
    for (let i = 0; i < collectedLives.length; i++) {
        let tw_resp = collectedLives[i];
        if (!tw_resp.is_live) {
            continue;
        }

        let start = _.get(tw_resp, "startTime", null);
        let publishedAt = moment.tz(start, "UTC").format();
        
        let old_mappings = _.find(video_sets, {"id": tw_resp["id"]});
        if (!isNone(old_mappings)) {
            
        }
    }
}

export async function twcastChannelsStats(filtersRun: FiltersConfig) {
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

    logger.info("twcastChannelsStats() fetching channels data...");
    let channels: TWCastChannelProps[] = (await TwitcastingChannel.find(findReq));
    if (channels.length < 1) {
        logger.warn("twcastChannelsStats() no registered channels");
        return;
    }

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
    const wrappedPromises: Promise<any>[] = resolveDelayCrawlerPromises(channelPromises, 300);
    logger.info("twcastChannelsStats() executing API requests...");
    const collectedChannels = (await Promise.all(wrappedPromises)).filter(res => Object.keys(res).length > 0);
    let updateData = [];
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

        let historyData: any[] = [];
        let oldData = _.find(channels, {"id": udata["id"]});
        if (typeof oldData !== "undefined") {
            // concat old set
            let oldHistoryData = _.get(oldData, "history", []);
            if (oldHistoryData.length === 0) {
                logger.error(`twcastChannelsStats() missing history data in old data for ID ${udata["id"]}`);
            } else {
                historyData = _.concat(historyData, oldHistoryData);
            }
        }

        historyData.push({
            timestamp: currentTimestamp,
            followerCount: udata["backerCount"],
            level: udata["level"],
        })

        // @ts-ignore
        let mappedUpdate: TWCastChannelProps = {
            "id": udata["id"],
            "name": udata["name"],
            "description": desc,
            "thumbnail": profile_img,
            "followerCount": udata["backerCount"],
            "level": udata["level"],
            "history": historyData
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
}