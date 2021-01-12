import axios, { AxiosInstance } from "axios";
import { YoutubeChannel, YoutubeVideo, YTChannelProps, YTVideoProps } from "../models/youtube";
import { logger } from "../utils/logger";
import { version as vt_version } from "../../package.json";
import _ from "lodash";
import { YTRotatingAPIKey } from "../utils/ytkey_rotator";
import { fallbackNaN, isNone } from "../utils/swissknife";
import moment from "moment-timezone";
import { FiltersConfig } from "../models";
import { resolveDelayCrawlerPromises } from "../utils/crawler";
import { ViewersData } from "../models/extras";

interface AnyDict {
    [key: string]: any;
}

interface FetchedVideo {
    [key: string]: string[]
}

interface XMLFetchedData {
    channel_id: string
    group: string
    video_id: string
}

const findVideoRegex = /<yt:videoId>(.*?)<\/yt:videoId>\s+\S+\s+<title>(.*?)<\/title>/gim;

function getBestThumbnail(thumbnails: any, video_id: string): string {
    if (_.has(thumbnails, "maxres")) {
        return thumbnails["maxres"]["url"];
    } else if (_.has(thumbnails, "standard")) {
        return thumbnails["standard"]["url"];
    } else if (_.has(thumbnails, "high")) {
        return thumbnails["high"]["url"];
    } else if (_.has(thumbnails, "medium")) {
        return thumbnails["medium"]["url"];
    } else if (_.has(thumbnails, "default")) {
        return thumbnails["default"]["url"];
    }
    return `https://i.ytimg.com/vi/${video_id}/maxresdefault.jpg`;
}

function checkForErrorsAndRotate(apiReponses: any, apiKeys: YTRotatingAPIKey) {
    let errors = _.get(apiReponses, "error", undefined);
    if (typeof errors === "undefined") {
        return false;
    }
    let errorsData: any[] = _.get(errors, "errors", []);
    if (errorsData.length < 1) {
        return false;
    }
    let firstErrors = errorsData[0];
    let errorReason = _.get(firstErrors, "reason", "unknown");
    if (errorReason === "rateLimitExceeded") {
        apiKeys.forceRotate();
    }
    return true;
}

async function checkIfMembershipStream(session: AxiosInstance, apiKeys: YTRotatingAPIKey, liveChatId: string): Promise<boolean | null> {
    let liveChatRequest = await session.get("https://youtube.googleapis.com/youtube/v3/liveChat/messages", {
        params: {
            "liveChatId": liveChatId,
            "part": "id",
            "maxResults": 1,
            "key": apiKeys.get(),
        },
        responseType: "json"
    }).catch((err) => {
        if (err.response) {
            // return response head
            return err.response;
        } else {
            logger.error(`checkIfMembershipStream() request error occured when trying to fetch chat ID ${liveChatId}, ${err.message}`);
            return undefined
        }
    })
    if (typeof liveChatRequest === "undefined") {
        return null;
    }
    let itemsData = _.get(liveChatRequest.data, "items", undefined);
    if (typeof itemsData !== "undefined" || liveChatRequest.status === 200) {
        return false;
    }
    let errors = _.get(liveChatRequest.data, "error", undefined);
    if (typeof errors === "undefined" || liveChatRequest.status === 200) {
        return false;
    }
    let errorsData: any[] = _.get(errors, "errors", []);
    if (errorsData.length < 1) {
        return false;
    }
    let firstErrors = errorsData[0];
    let errorReason = _.get(firstErrors, "reason", "unknown");
    if (errorReason === "rateLimitExceeded") {
        apiKeys.forceRotate();
        return null;
    }
    if (errorReason === "forbidden") {
        return true;
    }
    return null;
}

export async function youtubeVideoFeeds(apiKeys: YTRotatingAPIKey, filtersRun: FiltersConfig) {
    let session = axios.create({
        headers: {
            "User-Agent": `vtschedule-ts/${vt_version} (https://github.com/ihateani-me/vtscheduler-ts)`
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

    logger.info("youtubeVideoFeeds() fetching old video data...");
    let archive: YTVideoProps[] = (await YoutubeVideo.find(findReq));
    let fetched_video_ids: FetchedVideo = _.chain(archive)
                                            .groupBy((g) => g.channel_id)
                                            .mapValues((o) => _.map(o, (m) => m.id))
                                            .value();
    logger.info("youtubeVideoFeeds() fetching channels data...");
    let channels: YTChannelProps[] = (await YoutubeChannel.find(findReq));

    logger.info("youtubeVideoFeeds() creating job task for xml fetch...");
    const xmls_to_fetch = channels.map((channel) => (
        axios.get('https://www.youtube.com/feeds/videos.xml', {
            params: {
                channel_id: channel.id,
                t: Date.now(),
            },
        })
            .then((xmlResult) => (
                [...xmlResult.data.matchAll(findVideoRegex)]
                    .map((match) => ({
                        channel_id: channel.id,
                        video_id: match[1],
                        title: match[2],
                        group: channel.group,
                    }))
            ))
            .catch((fetchErr) => {
                logger.error(`youtubeVideoFeeds() Error fetching video list from XML feed channel: ${channel.id}, ${fetchErr.toString()}`);
                return [];
            })
    ));
    const wrappedPromises = resolveDelayCrawlerPromises(xmls_to_fetch, 300);

    logger.info(`youtubeVideoFeeds() start executing xml fetch, total: ${wrappedPromises.length}`);
    // @ts-ignore
    const collected_video_ids_flat: XMLFetchedData[] = _.flattenDeep(await Promise.all(wrappedPromises));
    if (collected_video_ids_flat.length < 1) {
        logger.warn(`youtubeVideoFeeds() no new videos`);
        return;
    }
    // @ts-ignore
    let video_ids_set: XMLFetchedData[] = collected_video_ids_flat.map((xml_data, idx) => {
        if (_.has(fetched_video_ids, xml_data.channel_id)) {
            if (_.includes(fetched_video_ids[xml_data.channel_id], xml_data.video_id)) {
                return [];
            }
        }
        return xml_data;
    })

    if (video_ids_set.length < 1) {
        logger.warn("youtubeVideoFeeds() no new videos");
        return;
    }

    logger.info(`youtubeVideoFeeds() Fetching videos`);
    // @ts-ignore
    const chunkedVideoFetch = _.chunk(_.flattenDeep(video_ids_set), 40);
    const video_to_fetch = chunkedVideoFetch.map((videos, idx) => (
        session.get("https://www.googleapis.com/youtube/v3/videos", {
            params: {
                part: "snippet,liveStreamingDetails,contentDetails",
                id: _.join(_.map(videos, "video_id"), ","),
                maxResults: 50,
                key: apiKeys.get()
            },
            responseType: "json"
        })
            .then((result) => {
                let yt_result = result.data;
                let is_error = checkForErrorsAndRotate(yt_result, apiKeys);
                if (is_error) {
                    // problem occured, sent empty array like my mind.
                    return [];
                }
                let items = yt_result["items"].map((res: { [x: string]: string | undefined; id: any; }) => {
                    let xml_res = _.find(videos, { "video_id": res.id });
                    // @ts-ignore
                    res["groupData"] = xml_res["group"];
                    return res;
                })
                return items;
            }).catch((err) => {
                if (err.response) {
                    let is_error = checkForErrorsAndRotate(err.response.data, apiKeys);
                    if (is_error) {
                        return [];
                    }
                }
                logger.error(`youtubeVideoFeeds() failed to fetch videos info for chunk ${idx}, error: ${err.toString()}`);
                return [];
            })
    ))
    const wrappedPromisesVideos = resolveDelayCrawlerPromises(video_to_fetch, 300);

    // @ts-ignore
    const youtube_videos_data: AnyDict[] = _.flattenDeep(await Promise.all(wrappedPromisesVideos));
    if (youtube_videos_data.length < 1) {
        logger.warn("youtubeVideoFeeds() no new videos");
        return;
    }
    logger.info(`youtubeVideoFeeds() Parsing ${youtube_videos_data.length} new videos`);
    const commitPromises = youtube_videos_data.map(async (res_item) => {
        let video_id = res_item["id"];
        let video_type;
        if (!_.has(res_item, "liveStreamingDetails")) {
            video_type = "video";
            res_item["liveStreamingDetails"] = {};
        }
        let snippets: AnyDict = res_item["snippet"];
        let livedetails: AnyDict = res_item["liveStreamingDetails"];
        if (!_.has(snippets, "liveBroadcastContent")) {
            video_type = "video";
        }
        let broadcast_cnt = snippets["liveBroadcastContent"];
        if (isNone(broadcast_cnt) || !broadcast_cnt) {
            video_type = "video";
        }
        if (!["live", "upcoming"].includes(broadcast_cnt)) {
            video_type = "video";
        } else {
            video_type = broadcast_cnt;
        }

        let channel_id = snippets["channelId"];
        let title = snippets["title"];
        let group = res_item["groupData"];
        let contentDetails = _.get(res_item, "contentDetails", {});

        let publishedAt = snippets["publishedAt"];

        let start_time = null;
        let ended_time = null;
        let scheduled_start_time = null;
        if (_.has(livedetails, "scheduledStartTime")) {
            scheduled_start_time = moment.tz(livedetails["scheduledStartTime"], "UTC").unix();
        }
        if (_.has(livedetails, "actualStartTime")) {
            start_time = moment.tz(livedetails["actualStartTime"], "UTC").unix();
            scheduled_start_time = moment.tz(livedetails["scheduledStartTime"], "UTC").unix();
        }
        if (_.has(livedetails, "actualEndTime")) {
            ended_time = moment.tz(livedetails["actualEndTime"], "UTC").unix();
            video_type = "past";
        }

        // check if premiere
        let is_premiere = false;
        if (["live", "upcoming"].includes(video_type)) {
            // https://en.wikipedia.org/wiki/ISO_8601#Durations
            // Youtube themselves decided to use P0D if there's no duration
            let iso86010S = ["P0D", "PT0S"];
            let durationTotal = _.get(contentDetails, "duration", undefined);
            if (typeof durationTotal === "string") {
                if (!iso86010S.includes(durationTotal)) {
                    is_premiere = true;
                } else {
                    is_premiere = false;
                }
            }
        }

        let duration = null;
        let lateness = null;
        if (start_time && ended_time) {
            duration = ended_time - start_time;
        }
        if (start_time && scheduled_start_time) {
            lateness = start_time - scheduled_start_time;
        }
        if (video_type === "upcoming") {
            start_time = scheduled_start_time;
        }

        let viewers = null,
            peak_viewers = null;
        if (_.has(livedetails, "concurrentViewers")) {
            viewers = peak_viewers = fallbackNaN(parseInt, livedetails["concurrentViewers"], livedetails["concurrentViewers"]);
        }

        let thumbs = getBestThumbnail(snippets["thumbnails"], video_id);

        let finalData: YTVideoProps = {
            id: video_id,
            title: title,
            status: video_type,
            timedata: {
                publishedAt: publishedAt,
                // @ts-ignore
                startTime: start_time,
                // @ts-ignore
                endTime: ended_time,
                // @ts-ignore
                scheduledStartTime: scheduled_start_time,
                // @ts-ignore
                lateTime: lateness,
                // @ts-ignore
                duration: duration
            },
            viewers: viewers,
            peakViewers: peak_viewers,
            channel_id: channel_id,
            thumbnail: thumbs,
            group: group,
            platform: "youtube",
            is_missing: false,
            is_premiere: is_premiere,
        }

        if (video_type === "live") {
            let viewNewData = {
                "id": video_id,
                "viewersData": [{
                    "timestamp": moment.tz("UTC").unix(),
                    "viewers": viewers
                }],
                "group": group,
                "platform": "youtube"
            }
            await ViewersData.insertMany([viewNewData]).catch((err) => {
                logger.error(`youtubeVideoFeeds() failed to create viewers data for ID ${video_id}, ${err.toString()}`);
            })

            // check if it's a member stream by doing a very scuffed way to check :)
            let liveChatId: string | undefined = _.get(livedetails, "activeLiveChatId", undefined);
            if (typeof liveChatId !== "undefined") {
                let isMembers = await checkIfMembershipStream(session, apiKeys, liveChatId);
                // @ts-ignore
                finalData["is_member"] = isMembers;
            }
        }

        return finalData;
    })

    const to_be_committed = await Promise.all(commitPromises);

    if (to_be_committed.length > 0) {
        logger.info(`youtubeVideoFeeds() inserting new videos to databases.`)
        await YoutubeVideo.insertMany(to_be_committed).catch((err) => {
            logger.error(`youtubeVideoFeeds() failed to insert to database.\n${err.toString()}`);
        });
    }
    logger.info("youtubeVideoFeeds() feeds updated!");
}

export async function youtubeLiveHeartbeat(apiKeys: YTRotatingAPIKey, filtersRun: FiltersConfig) {
    let session = axios.create({
        headers: {
            "User-Agent": `vtschedule-ts/${vt_version} (https://github.com/ihateani-me/vtscheduler-ts)`
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
    requestConfig.push({"status": {"$in": ["live", "upcoming"]}});

    let findReq: any = {};
    if (requestConfig.length > 0) {
        findReq["$and"] = requestConfig;
    }

    logger.info("youtubeLiveHeartbeat() fetching videos data...");
    let video_sets: YTVideoProps[] = (await YoutubeVideo.find(findReq));
    if (video_sets.length < 1) {
        logger.warn(`youtubeLiveHeartbeat() skipping because no new live/upcoming`);
        return;
    }

    const chunked_video_set = _.chunk(video_sets, 40);
    logger.info(`youtubeLiveHeartbeat() checking heartbeat on ${video_sets.length} videos (${chunked_video_set.length} chunks)...`);
    const items_data_promises = chunked_video_set.map((chunks, idx) => (
        session.get("https://www.googleapis.com/youtube/v3/videos", {
            params: {
                part: "snippet,liveStreamingDetails,contentDetails",
                id: _.join(_.map(chunks, "id"), ","),
                maxResults: 50,
                key: apiKeys.get()
            },
            responseType: "json"
        })
            .then((result) => {
                let yt_result = result.data;
                let is_error = checkForErrorsAndRotate(yt_result, apiKeys);
                if (is_error) {
                    // problem occured, sent empty array like my mind.
                    return [];
                }
                return yt_result["items"];
            }).catch((err) => {
                if (err.response) {
                    let is_error = checkForErrorsAndRotate(err.response.data, apiKeys);
                    if (is_error) {
                        return [];
                    }
                }
                logger.error(`youtubeLiveHeartbeat() failed to fetch videos info for chunk ${idx}, error: ${err.toString()}`);
                return [];
            })
    ))

    const wrappedPromises = resolveDelayCrawlerPromises(items_data_promises, 300);

    let items_data: any[] = await Promise.all(wrappedPromises).catch((err) => {
        logger.error(`youtubeLiveHeartbeat() failed to fetch from API, error: ${err.toString()}`)
        return [];
    });
    if (items_data.length < 1) {
        logger.warn("youtubeLiveHeartbeat() no response from API");
        return;
    }
    items_data = _.flattenDeep(items_data);
    logger.info(`youtubeLiveHeartbeat() preparing update...`);
    let commitPromises = items_data.map(async (res_item) => {
        let video_id = res_item["id"];
        let video_type;
        if (!_.has(res_item, "liveStreamingDetails")) {
            video_type = "video";
            res_item["liveStreamingDetails"] = {};
        }
        let snippets: AnyDict = res_item["snippet"];
        let livedetails: AnyDict = res_item["liveStreamingDetails"];
        if (!_.has(snippets, "liveBroadcastContent")) {
            video_type = "video";
        }
        let broadcast_cnt = snippets["liveBroadcastContent"];
        if (isNone(broadcast_cnt) || !broadcast_cnt) {
            video_type = "video";
        }
        if (!["live", "upcoming"].includes(broadcast_cnt)) {
            video_type = "video";
        } else {
            video_type = broadcast_cnt;
        }

        let title = snippets["title"];

        let publishedAt = snippets["publishedAt"];
        let contentDetails = _.get(res_item, "contentDetails", {});

        let start_time = null;
        let ended_time = null;
        let scheduled_start_time = null;
        if (_.has(livedetails, "scheduledStartTime")) {
            scheduled_start_time = moment.tz(livedetails["scheduledStartTime"], "UTC").unix();
        }
        if (_.has(livedetails, "actualStartTime")) {
            start_time = moment.tz(livedetails["actualStartTime"], "UTC").unix();
            scheduled_start_time = moment.tz(livedetails["scheduledStartTime"], "UTC").unix();
        }
        if (_.has(livedetails, "actualEndTime")) {
            ended_time = moment.tz(livedetails["actualEndTime"], "UTC").unix();
            video_type = "past";
        }

        let duration = null;
        let lateness = null;
        if (start_time && ended_time) {
            duration = ended_time - start_time;
        }
        if (start_time && scheduled_start_time) {
            lateness = start_time - scheduled_start_time;
        }
        if (video_type === "upcoming") {
            start_time = scheduled_start_time;
        }

        let oldData = _.find(video_sets, { "id": video_id });
        let currentViewers = _.get(oldData, "viewers", null);
        let currentPeakViewers = _.get(oldData, "peakViewers", null);
        let viewersData = _.get(livedetails, "concurrentViewers", undefined);
        if (typeof viewersData !== "undefined") {
            viewersData = fallbackNaN(parseInt, viewersData, viewersData);
            currentViewers = viewersData;
        }
        if (!_.isNull(currentPeakViewers) && !_.isNull(currentViewers)) {
            if (currentViewers > currentPeakViewers) {
                currentPeakViewers = currentViewers
            }
        } else if (_.isNull(currentPeakViewers) && !_.isNull(currentViewers)) {
            currentPeakViewers = currentViewers;
        }

        // check if premiere
        let is_premiere = _.get(oldData, "is_premiere", undefined);
        if (["live", "upcoming"].includes(video_type) && isNone(is_premiere)) {
            // https://en.wikipedia.org/wiki/ISO_8601#Durations
            // Youtube themselves decided to use P0D if there's no duration
            let iso86010S = ["P0D", "PT0S"];
            let durationTotal = _.get(contentDetails, "duration", undefined);
            if (typeof durationTotal === "string") {
                if (!iso86010S.includes(durationTotal)) {
                    is_premiere = true;
                } else {
                    is_premiere = false;
                }
            }
        }

        if (video_type === "live" && typeof currentViewers === "number") {
            let viewersDataArrays: {
                timestamp: number;
                viewers?: number | undefined;
            }[] = [];
            let currentViewersData = await ViewersData.findOne({"id": {"$eq": video_id}}).then((doc) => {
                return doc;
            }).catch((err) => {
                return undefined;
            });
            if (typeof currentViewersData !== "undefined" && !_.isNull(currentViewersData)) {
                viewersDataArrays = _.get(currentViewersData, "viewersData", []);
                viewersDataArrays.push({
                    timestamp: moment.tz("UTC").unix(),
                    viewers: currentViewers,
                });
                let viewUpdData = {
                    "id": currentViewersData["id"],
                    "viewersData": viewersDataArrays
                }
                try {
                    await ViewersData.updateOne({"id": {"$eq": currentViewersData["id"]}}, viewUpdData);
                } catch (e) {
                    logger.error(`youtubeLiveHeartbeat() Failed to update viewers data for ID ${video_id}, ${e.toString()}`);
                }
            } else {
                viewersDataArrays.push({
                    timestamp: moment.tz("UTC").unix(),
                    viewers: currentViewers,
                });
                let viewNewData = {
                    "id": video_id,
                    "viewersData": viewersDataArrays,
                    "group": _.get(oldData, "group", "unknown"),
                    "platform": "youtube"
                }
                await ViewersData.insertMany([viewNewData]).catch((err) => {
                    logger.error(`youtubeLiveHeartbeat() Failed to add viewers data for ID ${video_id}, ${err.toString()}`);
                })
            }
        }

        let thumbs = getBestThumbnail(snippets["thumbnails"], video_id);

        let finalData: YTVideoProps = {
            id: video_id,
            title: title,
            status: video_type,
            timedata: {
                publishedAt: publishedAt,
                // @ts-ignore
                startTime: start_time,
                // @ts-ignore
                endTime: ended_time,
                // @ts-ignore
                scheduledStartTime: scheduled_start_time,
                // @ts-ignore
                lateTime: lateness,
                // @ts-ignore
                duration: duration
            },
            // @ts-ignore
            viewers: currentViewers,
            // @ts-ignore
            peakViewers: currentPeakViewers,
            thumbnail: thumbs,
            is_missing: false,
            is_premiere: is_premiere,
        }
        if (video_type === "live") {
            // check if it's a member stream by doing a very scuffed way to check :)
            // this is even way more scuffed since I need to check if there's old data, and if it's already a boolean or not :)
            let oldMembersData = _.get(oldData, "is_member", undefined);
            if (typeof oldMembersData !== "boolean") {
                // since the old data still doesn't contains or, set to `null`, do a check!
                let liveChatId: string | undefined = _.get(livedetails, "activeLiveChatId", undefined);
                if (typeof liveChatId !== "undefined") {
                    let isMembers = await checkIfMembershipStream(session, apiKeys, liveChatId);
                    // @ts-ignore
                    finalData["is_member"] = isMembers;
                }
            }
        }
        if (video_type === "past") {
            let collectViewersData = await ViewersData.findOne({"id": {"$eq": video_id}, "platform": {"$eq": "youtube"}})
                                                        .then((doc) => {return doc})
                                                        .catch(() => {return undefined});
            if (typeof collectViewersData !== "undefined" && !_.isNull(collectViewersData)) {
                let viewersStats: any[] = _.get(collectViewersData, "viewersData", []);
                if (viewersStats.length > 0) {
                    let viewersNum = _.map(viewersStats, "viewers");
                    viewersNum = viewersNum.filter(v => typeof v === "number");
                    let averageViewers = Math.round(_.sum(viewersNum) / viewersNum.length);
                    finalData["averageViewers"] = isNaN(averageViewers) ? 0 : averageViewers;
                }
            }
        }
        return finalData;
    })
    let to_be_committed = await Promise.all(commitPromises);

    // check if something missing from the API
    let expectedResults = _.map(video_sets, "id");
    let actualResults = _.map(to_be_committed, "id");
    let differenceResults = _.difference(expectedResults, actualResults);
    if (differenceResults.length > 0) {
        logger.info(`youtubeLiveHeartbeat() missing ${differenceResults.length} videos from API results, marking it as missing and past`);
        let targetEndTime = moment.tz("UTC").unix();
        let filteredDifferences = [];
        for (let i = 0; i < differenceResults.length; i++) {
            let missingId = differenceResults[i];
            let idData = _.find(video_sets, {"id": missingId});
            if (typeof idData === "undefined") {
                logger.warn(`youtubeLiveHeartbeat() while checking missing response, ID ${missingId} are missing from database`);
                continue;
            }
            idData["is_missing"] = true;
            idData["status"] = "past";
            idData["timedata"]["endTime"] = targetEndTime;
            if (idData["timedata"]["startTime"]) {
                idData["timedata"]["duration"] = targetEndTime - idData["timedata"]["startTime"];
            }
            if (idData["timedata"]["startTime"] && idData["timedata"]["scheduledStartTime"]) {
                idData["timedata"]["lateTime"] = idData["timedata"]["startTime"] - idData["timedata"]["scheduledStartTime"];
            }
            filteredDifferences.push(idData);
        }
        to_be_committed = _.concat(to_be_committed, filteredDifferences);
    }
    let dataWithAverageViewers = _.filter(to_be_committed, (o) => _.has(o, "averageViewers"));
    if (dataWithAverageViewers.length > 0) {
        let viewersIdsToDelete = _.map(dataWithAverageViewers, "id");
        if (viewersIdsToDelete.length > 0) {
            logger.info(`youtubeLiveHeartbeat() removing ${viewersIdsToDelete.length} viewers data...`);
            try {
                await ViewersData.deleteMany({"id": {"$in": viewersIdsToDelete}});
            } catch (e) {
                logger.error(`youtubeLiveHeartbeat() failed to remove viewers data, ${e.toString()}`);
            }
            
        }
    }

    if (to_be_committed.length > 0) {
        logger.info(`youtubeLiveHeartbeat() committing update...`);
        const dbUpdate = to_be_committed.map((new_update) => (
            YoutubeVideo.findOneAndUpdate({ "id": { "$eq": new_update.id } }, new_update, null, (err) => {
                if (err) {
                    logger.error(`youtubeLiveHeartbeat() failed to update ${new_update.id}, ${err.toString()}`);
                } else {
                    return;
                }
            })
        ))
        await Promise.all(dbUpdate).catch((err) => {
            logger.error(`youtubeLiveHeartbeat() failed to update databases, ${err.toString()}`);
        })
    }

    logger.info("youtubeLiveHeartbeat() heartbeat updated!");
}

export async function youtubeChannelsStats(apiKeys: YTRotatingAPIKey, filtersRun: FiltersConfig) {
    let session = axios.create({
        headers: {
            "User-Agent": `vtschedule-ts/${vt_version} (https://github.com/ihateani-me/vtscheduler-ts)`
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

    logger.info("youtubeChannelsStats() fetching videos data...");
    let channels_data: YTChannelProps[] = (await YoutubeChannel.find(findReq));
    if (channels_data.length < 1) {
        logger.warn(`youtubeChannelsStats() skipping because no registered channels`);
        return;
    }

    const chunked_channels_set = _.chunk(channels_data, 40);
    logger.info(`youtubeChannelsStats() checking channels with total of ${channels_data.length} channels (${chunked_channels_set.length} chunks)...`);
    const items_data_promises = chunked_channels_set.map((chunks, idx) => (
        session.get("https://www.googleapis.com/youtube/v3/channels", {
            params: {
                part: "snippet,statistics",
                id: _.join(_.map(chunks, "id"), ","),
                maxResults: 50,
                key: apiKeys.get()
            },
            responseType: "json"
        })
            .then((result) => {
                let yt_result = result.data;
                return yt_result["items"];
            }).catch((err) => {
                logger.error(`youtubeChannelsStats() failed to fetch info for chunk ${idx}, error: ${err.toString()}`);
                return [];
            })
    ))

    let items_data: any[] = await Promise.all(items_data_promises).catch((err) => {
        logger.error(`youtubeChannelsStats() failed to fetch from API, error: ${err.toString()}`)
        return [];
    });
    if (items_data.length < 1) {
        logger.warn("youtubeChannelsStats() no response from API");
        return;
    }

    items_data = _.flattenDeep(items_data);
    logger.info(`youtubeChannelsStats() preparing update...`);
    let currentTimestamp = moment.tz("UTC").unix();
    const to_be_committed = items_data.map((res_item) => {
        let ch_id = res_item["id"];
        let snippets: AnyDict = res_item["snippet"];
        let statistics: AnyDict = res_item["statistics"];

        let title = snippets["title"];
        let desc = snippets["description"];

        let thumbs = getBestThumbnail(snippets["thumbnails"], "");
        let subsCount = 0,
            viewCount = 0,
            videoCount = 0;

        let historyData: any[] = [];

        if (_.has(statistics, "subscriberCount")) {
            subsCount = fallbackNaN(parseInt, statistics["subscriberCount"], statistics["subscriberCount"]);
        }
        if (_.has(statistics, "viewCount")) {
            viewCount = fallbackNaN(parseInt, statistics["viewCount"], statistics["viewCount"]);
        }
        if (_.has(statistics, "videoCount")) {
            videoCount = fallbackNaN(parseInt, statistics["videoCount"], statistics["videoCount"]);
        }
        let oldData = _.find(channels_data, {"id": ch_id});
        if (typeof oldData !== "undefined") {
            // concat old set
            let oldHistoryData = _.get(oldData, "history", []);
            if (oldHistoryData.length === 0) {
                logger.error(`youtubeChannelStats() missing history data in old data for ID ${ch_id}`);
            } else {
                historyData = _.concat(historyData, oldHistoryData);
            }
        }

        historyData.push({
            timestamp: currentTimestamp,
            subscriberCount: subsCount,
            viewCount: viewCount,
            videoCount: videoCount
        })

        // @ts-ignore
        let finalData: YTChannelProps = {
            id: ch_id,
            name: title,
            description: desc,
            thumbnail: thumbs,
            subscriberCount: subsCount,
            viewCount: viewCount,
            videoCount: videoCount,
            history: historyData,
        }
        return finalData;
    })

    if (to_be_committed.length > 0) {
        logger.info(`youtubeChannelsStats() committing update...`);
        const dbUpdate = to_be_committed.map((new_update) => (
            YoutubeChannel.findOneAndUpdate({ "id": { "$eq": new_update.id } }, new_update, null, (err) => {
                if (err) {
                    logger.error(`youtubeChannelsStats() failed to update ${new_update.id}, ${err.toString()}`);
                } else {
                    return;
                }
            })
        ))
        await Promise.all(dbUpdate).catch((err) => {
            logger.error(`youtubeChannelsStats() failed to update databases, ${err.toString()}`);
        })
    }

    logger.info("youtubeChannelsStats() channels stats updated!");
}

export async function youtubeVideoMissingCheck(apiKeys: YTRotatingAPIKey, filtersRun: FiltersConfig) {
    let session = axios.create({
        headers: {
            "User-Agent": `vtschedule-ts/${vt_version} (https://github.com/ihateani-me/vtscheduler-ts)`
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
    requestConfig.push({"is_missing": {"$eq": true}});

    let findReq: any = {};
    if (requestConfig.length > 0) {
        findReq["$and"] = requestConfig;
    }

    logger.info("youtubeVideoMissingCheck() fetching missing videos data...");
    let video_sets: YTVideoProps[] = (await YoutubeVideo.find(findReq));
    if (video_sets.length < 1) {
        logger.warn(`youtubeVideoMissingCheck() skipping because no missing video to check`);
        return;
    }

    const chunked_video_set = _.chunk(video_sets, 40);
    logger.info(`youtubeVideoMissingCheck() checking heartbeat on ${video_sets.length} videos (${chunked_video_set.length} chunks)...`);
    const items_data_promises = chunked_video_set.map((chunks, idx) => (
        session.get("https://www.googleapis.com/youtube/v3/videos", {
            params: {
                part: "snippet,liveStreamingDetails",
                id: _.join(_.map(chunks, "id"), ","),
                maxResults: 50,
                key: apiKeys.get()
            },
            responseType: "json"
        })
            .then((result) => {
                let yt_result = result.data;
                return yt_result["items"];
            }).catch((err) => {
                logger.error(`youtubeVideoMissingCheck() failed to fetch videos info for chunk ${idx}, error: ${err.toString()}`);
                return [];
            })
    ))

    const wrappedPromises = resolveDelayCrawlerPromises(items_data_promises, 300);

    let items_data: any[] = await Promise.all(wrappedPromises).catch((err) => {
        logger.error(`youtubeVideoMissingCheck() failed to fetch from API, error: ${err.toString()}`)
        return [];
    });
    if (items_data.length < 1) {
        logger.warn("youtubeVideoMissingCheck() no response from API");
        return;
    }
    items_data = _.flattenDeep(items_data);
    logger.info(`youtubeVideoMissingCheck() preparing update...`);
    let to_be_committed = items_data.map((res_item) => {
        let video_id = res_item["id"];
        let video_type;
        if (!_.has(res_item, "liveStreamingDetails")) {
            video_type = "video";
            res_item["liveStreamingDetails"] = {};
        }
        let snippets: AnyDict = res_item["snippet"];
        let livedetails: AnyDict = res_item["liveStreamingDetails"];
        if (!_.has(snippets, "liveBroadcastContent")) {
            video_type = "video";
        }
        let broadcast_cnt = snippets["liveBroadcastContent"];
        if (isNone(broadcast_cnt) || !broadcast_cnt) {
            video_type = "video";
        }
        if (!["live", "upcoming"].includes(broadcast_cnt)) {
            video_type = "video";
        } else {
            video_type = broadcast_cnt;
        }

        let title = snippets["title"];

        let start_time = null;
        let ended_time = null;
        if (_.has(livedetails, "scheduledStartTime")) {
            start_time = moment.tz(livedetails["scheduledStartTime"], "UTC").unix();
        } else if (_.has(livedetails, "actualStartTime")) {
            start_time = moment.tz(livedetails["actualStartTime"], "UTC").unix();
        }
        if (_.has(livedetails, "actualEndTime")) {
            ended_time = moment.tz(livedetails["actualEndTime"], "UTC").unix();
            video_type = "past";
        }

        let viewers = null;
        if (_.has(livedetails, "concurrentViewers")) {
            viewers = fallbackNaN(parseInt, livedetails["concurrentViewers"], livedetails["concurrentViewers"]);
        }

        let old_data = _.find(video_sets, { "id": video_id });
        let old_peak_viewers = old_data?.peakViewers;
        let new_peak: number;
        if (typeof old_peak_viewers === "number" && typeof viewers === "number") {
            if (viewers > old_peak_viewers) {
                new_peak = viewers;
            } else {
                new_peak = old_peak_viewers;
            }
        } else if (typeof viewers === "number") {
            new_peak = viewers;
        } else {
            // @ts-ignore
            new_peak = null;
        }

        let thumbs = getBestThumbnail(snippets["thumbnails"], video_id);

        let finalData: YTVideoProps = {
            id: video_id,
            title: title,
            status: video_type,
            // @ts-ignore
            startTime: start_time,
            // @ts-ignore
            endTime: ended_time,
            viewers: viewers,
            peakViewers: new_peak,
            thumbnail: thumbs,
            is_missing: false,
        }
        return finalData;
    })

    if (to_be_committed.length > 0) {
        logger.info(`youtubeVideoMissingCheck() committing update...`);
        const dbUpdate = to_be_committed.map((new_update) => (
            YoutubeVideo.findOneAndUpdate({ "id": { "$eq": new_update.id } }, new_update, null, (err) => {
                if (err) {
                    logger.error(`youtubeVideoMissingCheck() failed to update ${new_update.id}, ${err.toString()}`);
                } else {
                    return;
                }
            })
        ))
        await Promise.all(dbUpdate).catch((err) => {
            logger.error(`youtubeVideoMissingCheck() failed to update databases, ${err.toString()}`);
        })
    }
    logger.info("youtubeVideoMissingCheck() missing video checked!");
}