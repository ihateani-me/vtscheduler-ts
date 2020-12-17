import axios from "axios";
import { YoutubeChannel, YoutubeVideo, YTChannelProps, YTVideoProps } from "../models/youtube";
import { logger } from "../utils/logger";
import { version as vt_version } from "../../package.json";
import mongoose from 'mongoose';
import _ from "lodash";
import { YTRotatingAPIKey } from "../utils/ytkey_rotator";
import { fallbackNaN, filterEmpty, isNone } from "../utils/swissknife";
import moment from "moment";
import config from "../config.json";

let mongouri = config.mongodb.uri;
if (mongouri.endsWith("/")) {
    mongouri = mongouri.slice(0, -1);
}

mongoose.connect(`${mongouri}/${config.mongodb.dbname}`, {useNewUrlParser: true, useUnifiedTopology: true});

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
        return thumbnails["maxres"];
    } else if (_.has(thumbnails, "standard")) {
        return thumbnails["standard"];
    } else if (_.has(thumbnails, "high")) {
        return thumbnails["high"];
    } else if (_.has(thumbnails, "medium")) {
        return thumbnails["medium"];
    } else if (_.has(thumbnails, "default")) {
        return thumbnails["default"];
    }
    return `https://i.ytimg.com/vi/${video_id}/maxresdefault.jpg`;
}

async function youtubeVideoFeeds(apiKeys: YTRotatingAPIKey) {
    let session = axios.create({
        headers: {
            "User-Agent": `vtschedule-ts/${vt_version} (https://github.com/ihateani-me/vtscheduler-ts)`
        }
    })

    logger.info("youtubeVideoFeeds() fetching channels data...");
    let archive: YTVideoProps[] = await YoutubeVideo.find({});
    let fetched_video_ids: FetchedVideo = {};
    archive.forEach((res) => {
        if (!Array.isArray(fetched_video_ids[res.channel_id])) {
            fetched_video_ids[res.channel_id] = []
        }
        fetched_video_ids[res.channel_id].push(res.id);
    });

    let channels: YTChannelProps[] = await YoutubeChannel.find({});

    logger.info("youtubeVideoFeeds() creating job task for xml fetch...");
    const xmls_to_fetch = channels.map((channel) => (
        session.get("https://www.youtube.com/feeds/videos.xml", {
            params: {
                channel_id: channel.id,
                t: Date.now()
            },
        })
        .then((xmlResult) => {
            [...xmlResult.data.matchAll(findVideoRegex)]
                .map((match) => ({
                    channel_id: channel.id,
                    group: channel.group,
                    video_id: match[1]
                }))
        })
        .catch((err) => {
            logger.error(`youtubeVideoFeeds() failed to fetch videos xml feeds for ${channel.id}, error: ${err.toString()}`);
            return [];
        })
    ));

    // @ts-ignore
    const collected_video_ids_flat: XMLFetchedData[] = _.flattenDeep(await Promise.all(xmls_to_fetch));
    if (collected_video_ids_flat.length == 0) {
        logger.warn(`youtubeVideoFeeds() no new video`);
        return;
    }
    const collected_video_ids: XMLFetchedData[][] = _.chunk(collected_video_ids_flat, 40);
    // @ts-ignore
    let video_ids_set: XMLFetchedData[][] = collected_video_ids.map((xml_data, idx) => {
        if (xml_data.length == 0) {
            return [];
        }
        let video_ids = xml_data.map((res) => {
            if (fetched_video_ids[res.channel_id].includes(res.video_id)) {
                return null;
            }
            return {"video_id": res.video_id, "group": res.group};
        })
        video_ids = filterEmpty(video_ids);
        if (video_ids.length < 1) {
            logger.warn(`youtubeVideoFeeds() skipping chunk ${idx} since it's zero.`);
            return [];
        }
        return video_ids;
    })

    logger.info(`youtubeVideoFeeds() Fetching videos`);
    // @ts-ignore
    video_ids_set = _.flattenDeep(video_ids_set);
    // @ts-ignore
    video_ids_set = _.chunk(video_ids_set, 40);
    const video_to_fetch = video_ids_set.map((videos, idx) => (
        session.get("https://www.googleapis.com/youtube/v3/videos", {
            params: {
                part: "snippet,liveStreamingDetails",
                id: _.join(_.map(videos, "video_id"), ","),
                maxResults: 50,
                key: apiKeys.get()
            },
            responseType: "json"
        })
        .then((result) => {
            let yt_result = result.data;
            let items = yt_result["items"].map((res: { [x: string]: string | undefined; id: any; }) => {
                let xml_res = _.find(videos, {"video_id": res.id});
                res["groupData"] = xml_res?.group;
                return res;
            })
            return items;
        }).catch((err) => {
            logger.error(`youtubeVideoFeeds() failed to fetch videos info for chunk ${idx}, error: ${err.toString()}`);
            return [];
        })
    ))

    // @ts-ignore
    const youtube_videos_data: AnyDict[] = _.flattenDeep(await Promise.all(video_to_fetch));
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
            // @ts-ignore
            startTime: start_time,
            // @ts-ignore
            endTime: ended_time,
            viewers: viewers,
            peakViewers: peak_viewers,
            channel_id: channel_id,
            thumbnail: thumbs,
            group: group,
            platform: "youtube"
        }
        return finalData;
    })

    await YoutubeVideo.insertMany(to_be_committed).catch((err) => {
        logger.error(`youtubeVideoFeeds() failed to insert to database.\n${err.toString()}`);
    });
}

async function youtubeLiveHeartbeat(apiKeys: YTRotatingAPIKey) {
    let session = axios.create({
        headers: {
            "User-Agent": `vtschedule-ts/${vt_version} (https://github.com/ihateani-me/vtscheduler-ts)`
        }
    })

    logger.info("youtubeLiveHeartbeat() fetching videos data...");
    let video_sets: YTVideoProps[] = await YoutubeVideo.find({"status": {"$in": ["live", "upcoming"]}});
    if (video_sets.length < 1) {
        logger.warn(`youtubeLiveHeartbeat() skipping because no new live/upcoming`);
        return;
    }

    const chunked_video_set = _.chunk(video_sets, 40);
    logger.info(`youtubeLiveHeartbeat() checking heartbeat on ${video_sets.length} videos (${chunked_video_set.length} chunks)...`);
    const items_data_promises = video_sets.map((chunks, idx) => (
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
            let items = yt_result["items"].map((res: any) => {
                // @ts-ignore
                let video_data: YTVideoProps = _.find(chunks, {"id": res.id});
                res["groupData"] = video_data["group"];
                return res;
            })
            return items;
        }).catch((err) => {
            logger.error(`youtubeLiveHeartbeat() failed to fetch videos info for chunk ${idx}, error: ${err.toString()}`);
            return [];
        })
    ))

    let items_data: any[] = await Promise.all(items_data_promises).catch((err) => {
        logger.error(`youtubeLiveHeartbeat() failed to fetch from API, error: ${err.toString()}`)
        return [];
    });
    if (items_data.length < 1) {
        logger.warn("youtubeLiveHeartbeat() no response from API");
        return;
    }
    items_data = _.flattenDeep(items_data);
    logger.info(`youtubeLiveHeartbeat() preparing update...`);
    const to_be_committed = items_data.map((res_item) => {
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

        let old_data = _.find(video_sets, {"id": video_id});
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
            channel_id: channel_id,
            thumbnail: thumbs,
            group: group,
            platform: "youtube"
        }
        return finalData;
    })

    logger.info(`youtubeLiveHeartbeat() committing update...`);
    const dbUpdate = to_be_committed.map((new_update) => (
        YoutubeVideo.findOneAndUpdate({"id": {"$eq": new_update.id}}, new_update, null, (err) => {
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

async function youtubeChannelsStats(apiKeys: YTRotatingAPIKey) {
    let session = axios.create({
        headers: {
            "User-Agent": `vtschedule-ts/${vt_version} (https://github.com/ihateani-me/vtscheduler-ts)`
        }
    })

    logger.info("youtubeChannelsStats() fetching videos data...");
    let channels_data: YTChannelProps[] = await YoutubeChannel.find({});
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
            let items = yt_result["items"].map((res: any) => {
                // @ts-ignore
                let channel_data: YTChannelProps = _.find(chunks, {"id": res.id});
                res["groupData"] = channel_data["group"];
                return res;
            })
            return items;
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
    const to_be_committed = items_data.map((res_item) => {
        let ch_id = res_item["id"];
        let snippets: AnyDict = res_item["snippet"];
        let statistics: AnyDict = res_item["statistics"];

        let title = snippets["title"];
        let desc = snippets["description"];
        let pubAt = snippets["publishedAt"]
        let group = res_item["groupData"];

        let thumbs = getBestThumbnail(snippets["thumbnails"], "");
        let subsCount = 0,
            viewCount = 0,
            videoCount = 0;

        if (_.has(statistics, "subscriberCount")) {
            subsCount = fallbackNaN(parseInt, statistics["subscriberCount"], statistics["subscriberCount"]);
        }

        // @ts-ignore
        let finalData: YTChannelProps = {
            id: ch_id,
            name: title,
            description: desc,
            publishedAt: pubAt,
            thumbnail: thumbs,
            subscriberCount: subsCount,
            viewCount: viewCount,
            videoCount: videoCount,
            group: group,
            platform: "youtube"
        }
        return finalData;
    })

    logger.info(`youtubeChannelsStats() committing update...`);
    const dbUpdate = to_be_committed.map((new_update) => (
        YoutubeChannel.findOneAndUpdate({"id": {"$eq": new_update.id}}, new_update, null, (err) => {
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

export {
    youtubeLiveHeartbeat,
    youtubeVideoFeeds,
    youtubeChannelsStats
};