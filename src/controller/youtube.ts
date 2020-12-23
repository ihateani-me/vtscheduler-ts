import axios from "axios";
import { YoutubeChannel, YoutubeVideo, YTChannelProps, YTVideoProps } from "../models/youtube";
import { logger } from "../utils/logger";
import { version as vt_version } from "../../package.json";
import _, { toArray } from "lodash";
import { YTRotatingAPIKey } from "../utils/ytkey_rotator";
import { fallbackNaN, filterEmpty, isNone } from "../utils/swissknife";
import moment, { localeData } from "moment-timezone";
import { SkipRunConfig } from "../models";
import { resolveDelayCrawlerPromises } from "../utils/crawler";

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

export async function youtubeVideoFeeds(apiKeys: YTRotatingAPIKey, skipRunData: SkipRunConfig) {
    let session = axios.create({
        headers: {
            "User-Agent": `vtschedule-ts/${vt_version} (https://github.com/ihateani-me/vtscheduler-ts)`
        }
    })

    logger.info("youtubeVideoFeeds() fetching channels data...");
    let archive: YTVideoProps[] = (await YoutubeVideo.find({}))
        .filter(res => !skipRunData["groups"].includes(res.group))
        .filter(res => !skipRunData["channel_ids"].includes(res.channel_id));
    let fetched_video_ids: FetchedVideo = {};
    archive.forEach((res) => {
        if (!_.has(fetched_video_ids, res.channel_id)) {
            fetched_video_ids[res.channel_id] = []
        }
        fetched_video_ids[res.channel_id].push(res.id);
    });

    let channels: YTChannelProps[] = (await YoutubeChannel.find({}))
        .filter(res => !skipRunData["groups"].includes(res.group))
        .filter(res => !skipRunData["channel_ids"].includes(res.id));

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
    const wrappedPromises: Promise<{
        channel_id: string;
        video_id: any;
        title: any;
        group: string;
    }[] | never[]>[] = resolveDelayCrawlerPromises(xmls_to_fetch, 300);

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
                let items = yt_result["items"].map((res: { [x: string]: string | undefined; id: any; }) => {
                    let xml_res = _.find(videos, { "video_id": res.id });
                    // @ts-ignore
                    res["groupData"] = xml_res["group"];
                    return res;
                })
                return items;
            }).catch((err) => {
                logger.error(`youtubeVideoFeeds() failed to fetch videos info for chunk ${idx}, error: ${err.toString()}`);
                return [];
            })
    ))
    const wrappedPromisesVideos: Promise<any>[] = resolveDelayCrawlerPromises(video_to_fetch, 300);

    // @ts-ignore
    const youtube_videos_data: AnyDict[] = _.flattenDeep(await Promise.all(wrappedPromisesVideos));
    if (youtube_videos_data.length < 1) {
        logger.warn("youtubeVideoFeeds() no new videos");
        return;
    }
    logger.info(`youtubeVideoFeeds() Parsing ${youtube_videos_data.length} new videos`);
    const to_be_committed = youtube_videos_data.map((res_item) => {
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
        } else if (_.has(livedetails, "actualStartTime")) {
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
        return finalData;
    })

    if (to_be_committed.length > 0) {
        logger.info(`youtubeVideoFeeds() inserting new videos to databases.`)
        await YoutubeVideo.insertMany(to_be_committed).catch((err) => {
            logger.error(`youtubeVideoFeeds() failed to insert to database.\n${err.toString()}`);
        });
    }
}

export async function youtubeLiveHeartbeat(apiKeys: YTRotatingAPIKey, skipRunData: SkipRunConfig) {
    let session = axios.create({
        headers: {
            "User-Agent": `vtschedule-ts/${vt_version} (https://github.com/ihateani-me/vtscheduler-ts)`
        }
    })

    logger.info("youtubeLiveHeartbeat() fetching videos data...");
    let video_sets: YTVideoProps[] = (await YoutubeVideo.find({ "status": { "$in": ["live", "upcoming"] } }))
        .filter(res => !skipRunData["groups"].includes(res.group))
        .filter(res => !skipRunData["channel_ids"].includes(res.channel_id));
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
                return yt_result["items"];
            }).catch((err) => {
                logger.error(`youtubeLiveHeartbeat() failed to fetch videos info for chunk ${idx}, error: ${err.toString()}`);
                return [];
            })
    ))

    const wrappedPromises: Promise<any>[] = resolveDelayCrawlerPromises(items_data_promises, 300);

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

        // check if premiere
        let is_premiere = _.get(old_data, "is_premiere", undefined);
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
            peakViewers: new_peak,
            thumbnail: thumbs,
            is_missing: false,
            is_premiere: is_premiere,
        }
        return finalData;
    })

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
        to_be_committed = _.concat(filteredDifferences);
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
}

export async function youtubeChannelsStats(apiKeys: YTRotatingAPIKey, skipRunData: SkipRunConfig) {
    let session = axios.create({
        headers: {
            "User-Agent": `vtschedule-ts/${vt_version} (https://github.com/ihateani-me/vtscheduler-ts)`
        }
    })

    logger.info("youtubeChannelsStats() fetching videos data...");
    let channels_data: YTChannelProps[] = (await YoutubeChannel.find({}))
        .filter(res => !skipRunData["groups"].includes(res.group))
        .filter(res => !skipRunData["channel_ids"].includes(res.id));
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
}

export async function youtubeVideoMissingCheck(apiKeys: YTRotatingAPIKey, skipRunData: SkipRunConfig) {
    let session = axios.create({
        headers: {
            "User-Agent": `vtschedule-ts/${vt_version} (https://github.com/ihateani-me/vtscheduler-ts)`
        }
    })

    logger.info("youtubeVideoMissingCheck() fetching missing videos data...");
    let video_sets: YTVideoProps[] = (await YoutubeVideo.find({"is_missing": {"$eq": true}}))
        .filter(res => !skipRunData["groups"].includes(res.group))
        .filter(res => !skipRunData["channel_ids"].includes(res.channel_id));
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

    const wrappedPromises: Promise<any>[] = resolveDelayCrawlerPromises(items_data_promises, 300);

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
}