import _ from "lodash";
import axios from "axios";
import { DateTime, Duration } from "luxon";

import { logger } from "../utils/logger";
import { YTRotatingAPIKey } from "../utils/ytkey_rotator";
import { fallbackNaN, isNone } from "../utils/swissknife";
import { resolveDelayCrawlerPromises } from "../utils/crawler";

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

import { version as vt_version } from "../../package.json";

interface AnyDict {
    [key: string]: any;
}

interface FetchedVideo {
    [key: string]: string[];
}

interface XMLFetchedData {
    channel_id: string;
    group: string;
    video_id: string;
}

interface MentionedData {
    id: string;
    platform: "twitch" | "youtube" | "bilibili" | "twitcasting" | "mildom" | "twitter";
    isVanity?: boolean;
}

const findVideoRegex = /<yt:videoId>(.*?)<\/yt:videoId>\s+\S+\s+<title>(.*?)<\/title>/gim;
const EXPLICIT_DISALLOWED_MENTION = [
    // Animare cafe
    "UC8BS2IrE9NmxKLX7ObRVyxQ",
    // Hololive official
    "UCJFZiqLMntJufDCHc6bQixg",
    // Hololive English
    "UCotXwY6s8pWmuWd_snKYjhg",
    // Hololive Indonesia
    "UCfrWoRGlawPQDQxxeIDRP0Q",
    // Holostars Official
    "UCWsfcksUUpoEvhia0_ut0bA",
    // Kamitsubaki
    "UCAOhUv73jM5iCpOhuJOQzxA",
    // Nijisanji
    "UCX7YkU9nEeaoZbkVLVajcMg",
    // Nijisanji English
    "UC-JSeFfovhNsEhftt1WHMvg",
    // Norio
    "UCEd6G9T-jLieKWKVfpTlAKg",
    // SugarLyric
    "UCoieZAlwgK3uLkIYiJARDQw",
    // VAPArt
    "UCr83W-PdmmbstrvnCn9kdZQ",
];

/*
    If a channel match one of key in here,
    then it will be checked against the list that would be disallowed
    if match anything on disallowed, it would not be added.
*/
const GREY_AREA_DISALLOWED_MENTION = {
    "UC4YaOt1yT-ZeyB0OmxHgolA": ["UCbFwe3COkDrbNsbMyGNCsDg", "UCArUdy5xj0i0cTuhPHRVMpw"],
    UCbFwe3COkDrbNsbMyGNCsDg: ["UC4YaOt1yT-ZeyB0OmxHgolA", "UCArUdy5xj0i0cTuhPHRVMpw"],
    UCArUdy5xj0i0cTuhPHRVMpw: ["UCbFwe3COkDrbNsbMyGNCsDg", "UC4YaOt1yT-ZeyB0OmxHgolA"],
    "UC2hA-6M66dE2Tt_4xM8K9wQ": ["UCjtEttSHpJacfd7a6fc4VXQ"],
    UCjtEttSHpJacfd7a6fc4VXQ: ["UC2hA-6M66dE2Tt_4xM8K9wQ"],
    "UC1CfXB_kRs3C-zaeTG3oGyg": ["UCHj_mh57PVMXhAUDphUQDFA"],
    UCHj_mh57PVMXhAUDphUQDFA: ["UC1CfXB_kRs3C-zaeTG3oGyg"],
    UC1suqwovbL1kzsoaZgFZLKg: ["UCp3tgHXw_HI0QMk1K8qh3gQ"],
    UCp3tgHXw_HI0QMk1K8qh3gQ: ["UC1suqwovbL1kzsoaZgFZLKg"],
};

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

function checkForErrorsAndRotate(apiReponses: any, apiKeys: YTRotatingAPIKey): [boolean, boolean] {
    let errors = _.get(apiReponses, "error", undefined);
    if (typeof errors === "undefined") {
        return [false, false];
    }
    let errorsData: any[] = _.get(errors, "errors", []);
    if (errorsData.length < 1) {
        return [false, false];
    }
    let firstErrors = errorsData[0];
    logger.error(
        `checkForErrorsAndRotate() an API error occured, raw dump of it here: ${JSON.stringify(
            firstErrors,
            undefined,
            2
        )} `
    );
    let errorReason = _.get(firstErrors, "reason", "unknown");
    let quotaExhausted = false;
    if (errorReason === "rateLimitExceeded" || errorReason === "quotaExceeded") {
        apiKeys.forceRotate();
        quotaExhausted = true;
    }
    return [true, quotaExhausted];
}

function iterateMatchAllSelect(
    iteration: IterableIterator<RegExpMatchArray>,
    index: number | number[] = 0
): (string | string[])[] {
    const collectedString = [];
    let nextData = iteration.next();
    while (!nextData.done) {
        if (Array.isArray(index)) {
            const collected: string[] = [];
            index.forEach((idx) => {
                collected.push(nextData.value[idx]);
            });
            collectedString.push(collected);
        } else {
            collectedString.push(nextData.value[index]);
        }
        nextData = iteration.next();
    }
    return collectedString;
}

function matchPlatformIDs(description: string) {
    const youtubeRE = /https?\:\/{2}[w]{3}?\.?youtube\.com\/(channel|c|user)\/([a-z0-9\-\_]+)/gi;
    const twitchTVRe = /https?\:\/{2}twitch\.tv\/([a-z0-9\-\_]+)/gi;
    const youtubeMatched = iterateMatchAllSelect(description.matchAll(youtubeRE), [1, 2]).flatMap((res) => {
        if (Array.isArray(res) && res.length === 2) {
            const [chPath, channelId] = res as unknown as string[];
            return { id: channelId.trim(), platform: "youtube", isVanity: chPath !== "channel" };
        } else if (Array.isArray(res)) {
            const counted = res.length;
            if (counted === 1 && typeof res[0] === "string") {
                return { id: res[0].trim(), platform: "youtube", isVanity: false };
            }
        } else if (typeof res === "string") {
            return { id: res.trim(), platform: "youtube", isVanity: false };
        }
        return { id: "", platform: "youtube", isVanity: false };
    }) as unknown as MentionedData[];
    const twitchMatched = iterateMatchAllSelect(description.matchAll(twitchTVRe), 1).flatMap((res) => {
        const niceName = res as string;
        return { id: niceName.trim(), platform: "twitch", isVanity: false };
    }) as unknown as MentionedData[];
    return [...youtubeMatched, ...twitchMatched];
}

function fallbackMatchMention(description: string): string[] {
    // Clean up some results
    const cleanUpMentionResult = (result: string) => {
        if (result.endsWith("/") || result.endsWith("\\") || result.endsWith("／")) {
            result = result.slice(0, -1);
        }
        return result.trim();
    }

    const mentionChannelMatch = /\@/gi;

    const allMatched = description.matchAll(mentionChannelMatch);
    const collectedString = [];
    const collectedRanges = [];
    let nextData = allMatched.next();
    while (!nextData.done) {
        collectedRanges.push(nextData.value.index);
        nextData = allMatched.next();
    }
    for (let i = 0; i < collectedRanges.length; i++) {
        const start = collectedRanges[i];
        const end = collectedRanges[i + 1];

        let cutFrom = description.slice(start);
        if (typeof end === "number") {
            cutFrom = description.slice(start, end);
            let endNewLine = cutFrom.indexOf("\n");
            if (endNewLine !== -1) {
                cutFrom = cutFrom.slice(0, endNewLine);
            }
        } else {
            let endNewLine = cutFrom.indexOf("\n");
            if (endNewLine === -1) {
                endNewLine = cutFrom.length;
            }
            cutFrom = cutFrom.slice(0, endNewLine);
        }
        cutFrom = cutFrom.trim().slice(1);
        collectedString.push(cleanUpMentionResult(cutFrom));
    }
    return collectedString;
}

function matchDescriptionMentions(description: string): [MentionedData[], string[]] {
    if (isNone(description, true)) {
        return [[], []];
    }
    const mentionChannelMatch = /@(.*?)\n/gi;

    const allMatchedChannelURL = matchPlatformIDs(description);
    const allMatchedMentionName = iterateMatchAllSelect(description.matchAll(mentionChannelMatch), 1).flatMap(
        // @ts-ignore
        (res) => res.trim()
    ) as string[];
    // This is scuffed way to check for mentions in description.
    // I want to fetch the webpage directly and fetch the description from the
    // ytInitialData since it contains parsed data, but it's costly to request from the API
    // then request to the webpage.
    // So this is a fallback.
    const fallbackMentionName = fallbackMatchMention(description);
    fallbackMentionName.forEach((name) => {
        if (!allMatchedMentionName.includes(name)) {
            allMatchedMentionName.push(name);
        };
    });
    return [allMatchedChannelURL, allMatchedMentionName];
}

export async function youtubeVideoFeeds(apiKeys: YTRotatingAPIKey, filtersRun: FiltersConfig) {
    let session = axios.create({
        headers: {
            "User-Agent": `vtschedule-ts/${vt_version} (https://github.com/ihateani-me/vtscheduler-ts)`,
        },
    });

    logger.info("youtubeVideoFeeds() fetching old video data...");
    let archive = await VideosData.filteredFind(
        filtersRun["exclude"],
        filtersRun["include"],
        { id: 1, channel_id: 1 },
        [{ platform: { $eq: "youtube" } }]
    );
    let fetched_video_ids: FetchedVideo = _.chain(archive)
        .groupBy((g) => g.channel_id)
        .mapValues((o) => _.map(o, (m) => m.id))
        .value();
    logger.info("youtubeVideoFeeds() fetching channels data...");
    let fullChannels: ChannelsProps[] = await ChannelsData.find({
        platform: { $in: ["youtube", "twitch"] },
        is_retired: {$eq: false},
    }, {
        id: 1,
        yt_custom_id: 1,
        name: 1,
        platform: 1,
        group: 1,
    })
    let channels = fullChannels.filter((e) => e.platform === "youtube");
    logger.info(`Got ${channels.length} originally, filtering with exclude/include...`);
    const includedFilter = filtersRun.include;
    const excludedFilter = filtersRun.exclude;
    if (includedFilter.groups.length > 0) {
        channels = channels.filter((e) => includedFilter.groups.includes(e.group));
    }
    if (includedFilter.channel_ids.length > 0) {
        channels = channels.filter((e) => includedFilter.channel_ids.includes(e.id));
    }
    logger.info(`After filtering, got ${channels.length} channels.`);
    if (excludedFilter.groups.length > 0) {
        channels = channels.filter((e) => !excludedFilter.groups.includes(e.group));
    }
    if (excludedFilter.channel_ids.length > 0) {
        channels = channels.filter((e) => !excludedFilter.channel_ids.includes(e.id));
    }
    logger.info(`After filtering again, got ${channels.length} channels.`);

    logger.info(`youtubeVideoFeeds() creating ${channels.length} job task for xml fetch...`);
    const xmls_to_fetch = channels.map((channel) =>
        axios
            .get("https://www.youtube.com/feeds/videos.xml", {
                params: {
                    channel_id: channel.id,
                    t: Date.now(),
                },
            })
            .then((xmlResult) =>
                [...xmlResult.data.matchAll(findVideoRegex)].map((match) => ({
                    channel_id: channel.id,
                    video_id: match[1],
                    title: match[2],
                    group: channel.group,
                }))
            )
            .catch((fetchErr) => {
                logger.error(
                    `youtubeVideoFeeds() Error fetching video list from XML feed channel: ${
                        channel.id
                    }, ${fetchErr.toString()}`
                );
                return [];
            })
    );
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
    });

    if (video_ids_set.length < 1) {
        logger.warn("youtubeVideoFeeds() no new videos");
        return;
    }

    // Check if quota ran out before updating!
    let is_quota_ran_out = false;
    logger.info(`youtubeVideoFeeds() Fetching videos`);
    // @ts-ignore
    const chunkedVideoFetch = _.chunk(_.flattenDeep(video_ids_set), 40);
    const video_to_fetch = chunkedVideoFetch.map((videos, idx) =>
        session
            .get("https://www.googleapis.com/youtube/v3/videos", {
                params: {
                    part: "snippet,liveStreamingDetails,contentDetails,statistics",
                    id: _.join(_.map(videos, "video_id"), ","),
                    maxResults: 50,
                    key: apiKeys.get(),
                },
                responseType: "json",
            })
            .then((result) => {
                let yt_result = result.data;
                let [is_error, quotaExhausted] = checkForErrorsAndRotate(yt_result, apiKeys);
                is_quota_ran_out = quotaExhausted;
                if (is_error) {
                    // problem occured, sent empty array like my mind.
                    return [];
                }
                let items = yt_result["items"].map((res: { [x: string]: string | undefined; id: any }) => {
                    let xml_res = _.find(videos, { video_id: res.id });
                    // @ts-ignore
                    res["groupData"] = xml_res["group"];
                    return res;
                });
                return items;
            })
            .catch((err) => {
                if (err.response) {
                    let [is_error, quotaExhausted] = checkForErrorsAndRotate(err.response.data, apiKeys);
                    is_quota_ran_out = quotaExhausted;
                    if (is_error) {
                        return [];
                    }
                }
                logger.error(
                    `youtubeVideoFeeds() failed to fetch videos info for chunk ${idx}, error: ${err.toString()}`
                );
                return [];
            })
    );
    const wrappedPromisesVideos = resolveDelayCrawlerPromises(video_to_fetch, 300);

    // @ts-ignore
    const youtube_videos_data: AnyDict[] = _.flattenDeep(await Promise.all(wrappedPromisesVideos));
    if (youtube_videos_data.length < 1) {
        logger.warn("youtubeVideoFeeds() no new videos");
        return;
    }
    logger.info(`youtubeVideoFeeds() Parsing ${youtube_videos_data.length} new videos`);
    const insertThisData: any[] = [];
    for (let i = 0; i < youtube_videos_data.length; i++) {
        const res_item = youtube_videos_data[i];
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
        const statistics: AnyDict = _.get(res_item, "statistics", {});

        let [mentionChID, mentionedName] = matchDescriptionMentions(snippets["description"]);
        let disallowedChannelMentions =
            GREY_AREA_DISALLOWED_MENTION[channel_id as keyof typeof GREY_AREA_DISALLOWED_MENTION];
        if (!Array.isArray(disallowedChannelMentions)) {
            disallowedChannelMentions = [];
        }
        const actualChannelMentioned = [] as MentionedData[];
        mentionChID.forEach((r) => {
            let details = _.find(fullChannels, (o) => o.id === r.id);
            if (r.isVanity) {
                // Case insensitive check, since yt_custom_id will be mostly lowercased
                details = _.find(
                    fullChannels,
                    (o) =>
                        o.yt_custom_id?.toLowerCase() === r.id.toLowerCase() ||
                        o.yt_custom_id?.toUpperCase() === r.id.toUpperCase() ||
                        o.yt_custom_id === r.id
                );
            }
            if (!isNone(details)) {
                if (
                    details.id !== channel_id &&
                    !EXPLICIT_DISALLOWED_MENTION.includes(details.id) &&
                    !disallowedChannelMentions.includes(details.id)
                ) {
                    actualChannelMentioned.push({ id: details.id, platform: r.platform });
                }
            }
        });
        mentionedName.forEach((r) => {
            const details = _.find(fullChannels, (o) => o.name === r);
            if (!isNone(details)) {
                if (
                    details.id !== channel_id &&
                    !EXPLICIT_DISALLOWED_MENTION.includes(details.id) &&
                    !disallowedChannelMentions.includes(details.id)
                ) {
                    actualChannelMentioned.push({ id: details.id, platform: details.platform });
                }
            }
        });
        let publishedAt = snippets["publishedAt"];

        let start_time = null;
        let ended_time = null;
        let scheduled_start_time = null;
        if (_.has(livedetails, "scheduledStartTime")) {
            scheduled_start_time = DateTime.fromISO(livedetails["scheduledStartTime"], {
                zone: "UTC",
            }).toSeconds();
        }
        if (_.has(livedetails, "actualStartTime")) {
            start_time = DateTime.fromISO(livedetails["actualStartTime"], { zone: "UTC" }).toSeconds();
            scheduled_start_time = DateTime.fromISO(livedetails["scheduledStartTime"], {
                zone: "UTC",
            }).toSeconds();
        }
        if (_.has(livedetails, "actualEndTime")) {
            ended_time = DateTime.fromISO(livedetails["actualEndTime"], { zone: "UTC" }).toSeconds();
            video_type = "past";
        }

        // check if premiere
        let is_premiere = false;
        if (["live", "upcoming", "past"].includes(video_type)) {
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

        // Prefil the start and end time for video type
        if (video_type === "video") {
            const parsedTime = DateTime.fromISO(publishedAt, { zone: "UTC" }).toSeconds();
            start_time = parsedTime;
            ended_time = parsedTime;
        }

        let viewers = null,
            peak_viewers = null;
        if (_.has(livedetails, "concurrentViewers")) {
            viewers = peak_viewers = fallbackNaN(
                parseInt,
                livedetails["concurrentViewers"],
                livedetails["concurrentViewers"]
            );
        }

        let thumbs = getBestThumbnail(snippets["thumbnails"], video_id);

        let finalData: VideoProps = {
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
                duration: duration,
            },
            viewers: viewers,
            peakViewers: peak_viewers,
            channel_id: channel_id,
            mentioned: actualChannelMentioned,
            thumbnail: thumbs,
            group: group,
            platform: "youtube",
            is_missing: false,
            is_premiere: is_premiere,
        };

        if (video_type === "live") {
            let viewNewData = {
                id: video_id,
                viewersData: [
                    {
                        timestamp: Math.floor(DateTime.utc().toSeconds()),
                        viewers: viewers,
                    },
                ],
                group: group,
                platform: "youtube",
            };
            await ViewersData.insertMany([viewNewData]).catch((err) => {
                logger.error(
                    `youtubeVideoFeeds() failed to create viewers data for ID ${video_id}, ${err.toString()}`
                );
            });

            // check if it's a member stream by doing a very scuffed way to check :)
            let liveChatId: string | undefined = _.get(livedetails, "activeLiveChatId", undefined);
            if (
                typeof liveChatId !== "undefined" &&
                !_.has(livedetails, "concurrentViewers") &&
                !_.has(statistics, "viewCount")
            ) {
                // Viewers is hidden, status is live, viewCount are missing, and liveChat exist
                // It just means that the stream are most likely to be members-only mode.
                // This should save a lot of API call :)
                // And can be more consistent, if they since middleway through
                finalData["is_member"] = true;
            }
        }

        insertThisData.push(finalData);   
    };

    if (insertThisData.length > 0) {
        logger.info(`youtubeVideoFeeds() inserting new videos to databases.`);
        await VideosData.insertMany(insertThisData).catch((err) => {
            logger.error(`youtubeVideoFeeds() failed to insert to database.\n${err.toString()}`);
        });
    }
    logger.info("youtubeVideoFeeds() feeds updated!");
}

export async function youtubeLiveHeartbeat(apiKeys: YTRotatingAPIKey, filtersRun: FiltersConfig) {
    let session = axios.create({
        headers: {
            "User-Agent": `vtschedule-ts/${vt_version} (https://github.com/ihateani-me/vtscheduler-ts)`,
        },
    });

    logger.info("youtubeLiveHeartbeat() fetching videos data...");
    let video_sets = await VideosData.filteredFind(filtersRun["exclude"], filtersRun["include"], undefined, [
        { platform: { $eq: "youtube" } },
        { status: { $in: ["live", "upcoming"] } },
    ]);
    if (video_sets.length < 1) {
        logger.warn(`youtubeLiveHeartbeat() skipping because no new live/upcoming`);
        return;
    }
    logger.info("youtubeLiveHeartbeat() fetching channels data...");
    let fullChannels: ChannelsProps[] = await ChannelsData.find({
        platform: { $in: ["youtube", "twitch"] },
        is_retired: {$eq: false},
    }, {
        id: 1,
        yt_custom_id: 1,
        name: 1,
        platform: 1,
    })
    // Some got caught in this
    video_sets = video_sets.filter((e) => e.platform === "youtube");

    // Check if quota ran out before updating!
    let is_quota_ran_out = false;
    const chunked_video_set = _.chunk(video_sets, 40);
    logger.info(
        `youtubeLiveHeartbeat() checking heartbeat on ${video_sets.length} videos (${chunked_video_set.length} chunks)...`
    );
    const items_data_promises = chunked_video_set.map((chunks, idx) =>
        session
            .get("https://www.googleapis.com/youtube/v3/videos", {
                params: {
                    part: "snippet,liveStreamingDetails,contentDetails,statistics",
                    id: _.join(_.map(chunks, "id"), ","),
                    maxResults: 50,
                    key: apiKeys.get(),
                },
                responseType: "json",
            })
            .then((result) => {
                let yt_result = result.data;
                let [is_error, quotaExhausted] = checkForErrorsAndRotate(yt_result, apiKeys);
                is_quota_ran_out = quotaExhausted;
                if (is_error) {
                    // problem occured, sent empty array like my mind.
                    return [];
                }
                return yt_result["items"];
            })
            .catch((err) => {
                if (err.response) {
                    let [is_error, quotaExhausted] = checkForErrorsAndRotate(err.response.data, apiKeys);
                    is_quota_ran_out = quotaExhausted;
                    if (is_error) {
                        return [];
                    }
                }
                logger.error(
                    `youtubeLiveHeartbeat() failed to fetch videos info for chunk ${idx}, error: ${err.toString()}`
                );
                return [];
            })
    );

    const wrappedPromises = resolveDelayCrawlerPromises(items_data_promises, 300);

    let items_data: any[] = await Promise.all(wrappedPromises).catch((err) => {
        logger.error(`youtubeLiveHeartbeat() failed to fetch from API, error: ${err.toString()}`);
        return [];
    });
    if (items_data.length < 1) {
        logger.warn("youtubeLiveHeartbeat() no response from API");
        return;
    }
    items_data = _.flattenDeep(items_data);
    logger.info(`youtubeLiveHeartbeat() preparing update...`);
    let updateData: any[] = [];
    for (let i = 0; i < items_data.length; i++) {
        const res_item = items_data[i];

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

        let channel_id = snippets["channelId"];
        let publishedAt = snippets["publishedAt"];
        let contentDetails = _.get(res_item, "contentDetails", {});
        const statistics: AnyDict = _.get(res_item, "statistics", {});

        let [mentionChID, mentionedName] = matchDescriptionMentions(snippets["description"]);
        let disallowedChannelMentions =
            GREY_AREA_DISALLOWED_MENTION[channel_id as keyof typeof GREY_AREA_DISALLOWED_MENTION];
        if (!Array.isArray(disallowedChannelMentions)) {
            disallowedChannelMentions = [];
        }

        const actualChannelMentioned = [] as MentionedData[];
        mentionChID.forEach((r) => {
            let details = _.find(fullChannels, (o) => o.id === r.id);
            if (r.isVanity) {
                // Case insensitive check, since yt_custom_id will be mostly lowercased
                details = _.find(
                    fullChannels,
                    (o) =>
                        o.yt_custom_id?.toLowerCase() === r.id.toLowerCase() ||
                        o.yt_custom_id?.toUpperCase() === r.id.toUpperCase() ||
                        o.yt_custom_id === r.id
                );
            }
            if (!isNone(details)) {
                if (
                    details.id !== channel_id &&
                    !EXPLICIT_DISALLOWED_MENTION.includes(details.id) &&
                    !disallowedChannelMentions.includes(details.id)
                ) {
                    actualChannelMentioned.push({ id: details.id, platform: r.platform });
                }
            }
        });
        mentionedName.forEach((r) => {
            const details = fullChannels.find((o) => o.name === r);
            if (!isNone(details)) {
                if (
                    details.id !== channel_id &&
                    !EXPLICIT_DISALLOWED_MENTION.includes(details.id) &&
                    !disallowedChannelMentions.includes(details.id)
                ) {
                    actualChannelMentioned.push({ id: details.id, platform: details.platform });
                }
            }
        });

        let start_time = null;
        let ended_time = null;
        let scheduled_start_time = null;
        if (_.has(livedetails, "scheduledStartTime")) {
            scheduled_start_time = DateTime.fromISO(livedetails["scheduledStartTime"], {
                zone: "UTC",
            }).toSeconds();
        }
        if (_.has(livedetails, "actualStartTime")) {
            start_time = DateTime.fromISO(livedetails["actualStartTime"], { zone: "UTC" }).toSeconds();
            scheduled_start_time = DateTime.fromISO(livedetails["scheduledStartTime"], {
                zone: "UTC",
            }).toSeconds();
        }
        if (_.has(livedetails, "actualEndTime")) {
            ended_time = DateTime.fromISO(livedetails["actualEndTime"], { zone: "UTC" }).toSeconds();
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

        let oldData = _.find(video_sets, { id: video_id });
        let currentViewers = _.get(oldData, "viewers", null);
        let currentPeakViewers = _.get(oldData, "peakViewers", null);
        let viewersData = _.get(livedetails, "concurrentViewers", undefined);
        if (typeof viewersData !== "undefined") {
            viewersData = fallbackNaN(parseInt, viewersData, viewersData);
            currentViewers = viewersData;
        }
        if (!_.isNull(currentPeakViewers) && !_.isNull(currentViewers)) {
            if (currentViewers > currentPeakViewers) {
                currentPeakViewers = currentViewers;
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
                    // Set the duration in seconds
                    duration = Math.ceil(Duration.fromISO(durationTotal).toMillis() / 1000);
                } else {
                    is_premiere = false;
                }
            }
        }
        if (is_premiere) {
            let durationTotal = _.get(contentDetails, "duration", undefined);
            if (typeof durationTotal === "string") {
                const parse = Duration.fromISO(durationTotal);
                if (parse.isValid) {
                    duration = Math.ceil(parse.toMillis() / 1000);
                }
            }
        }

        let thumbs = getBestThumbnail(snippets["thumbnails"], video_id);

        let finalData: VideoProps = {
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
                duration: duration,
            },
            // @ts-ignore
            viewers: currentViewers,
            // @ts-ignore
            peakViewers: currentPeakViewers,
            mentioned: actualChannelMentioned,
            thumbnail: thumbs,
            is_missing: false,
            is_premiere: is_premiere,
        };

        if (video_type === "live") {
            // check if it's a member stream by doing a very scuffed way to check :)
            let liveChatId: string | undefined = _.get(livedetails, "activeLiveChatId", undefined);
            if (typeof liveChatId !== "undefined") {
                // Viewers is hidden, status is live, viewCount are missing, and liveChat exist
                // It just means that the stream are most likely to be members-only mode.
                // This should save a lot of API call :)
                // And can be more consistent, if they since middleway through
                if (!_.has(livedetails, "concurrentViewers") && !_.has(statistics, "viewCount")) {
                    finalData["is_member"] = true;
                } else {
                    finalData["is_member"] = false;
                }
            }
        }
        if (video_type === "past") {
            let collectViewersData = await ViewersData.findOne({
                id: { $eq: video_id },
                platform: { $eq: "youtube" },
            })
                .then((doc) => {
                    return doc;
                })
                .catch(() => {
                    return undefined;
                });
            if (typeof collectViewersData !== "undefined" && !_.isNull(collectViewersData)) {
                let viewersStats: any[] = _.get(collectViewersData, "viewersData", []);
                if (viewersStats.length > 0) {
                    let viewersNum = _.map(viewersStats, "viewers");
                    viewersNum = viewersNum.filter((v) => typeof v === "number");
                    let averageViewers = Math.round(_.sum(viewersNum) / viewersNum.length);
                    finalData["averageViewers"] = isNaN(averageViewers) ? 0 : averageViewers;
                }
            }
        }

        if (video_type === "live" && typeof currentViewers === "number") {
            let viewersDataArrays: {
                timestamp: number;
                viewers?: number | undefined;
            }[] = [];
            let currentViewersData = await ViewersData.findOne({ id: { $eq: video_id } })
                .then((doc) => {
                    return doc;
                })
                .catch((err) => {
                    return undefined;
                });
            if (typeof currentViewersData !== "undefined" && !_.isNull(currentViewersData)) {
                viewersDataArrays = _.get(currentViewersData, "viewersData", []);
                viewersDataArrays.push({
                    timestamp: Math.floor(DateTime.utc().toSeconds()),
                    viewers: currentViewers,
                });
                let viewUpdData = {
                    id: currentViewersData["id"],
                    viewersData: viewersDataArrays,
                };
                try {
                    await ViewersData.updateOne({ id: { $eq: currentViewersData["id"] } }, viewUpdData);
                } catch (e: any) {
                    logger.error(
                        `youtubeLiveHeartbeat() Failed to update viewers data for ID ${video_id}, ${e.toString()}`
                    );
                }
            } else {
                viewersDataArrays.push({
                    timestamp: Math.floor(DateTime.utc().toSeconds()),
                    viewers: currentViewers,
                });
                let viewNewData = {
                    id: video_id,
                    viewersData: viewersDataArrays,
                    group: _.get(oldData, "group", "unknown"),
                    platform: "youtube",
                };
                await ViewersData.insertMany([viewNewData]).catch((err) => {
                    logger.error(
                        `youtubeLiveHeartbeat() Failed to add viewers data for ID ${video_id}, ${err.toString()}`
                    );
                });
            }
        }

        updateData.push(finalData);
    }

    // check if something missing from the API
    let expectedResults = _.map(video_sets, "id");
    let actualResults = _.map(updateData, "id");
    let differenceResults = _.difference(expectedResults, actualResults);
    // Check if there's difference and make sure only run if the quota is fine and not running out.
    // So it doesn't fuck currently running stream.
    if (differenceResults.length > 0 && !is_quota_ran_out) {
        logger.info(
            `youtubeLiveHeartbeat() missing ${differenceResults.length} videos from API results, marking it as missing and past`
        );
        let targetEndTime = Math.floor(DateTime.utc().toSeconds());
        let filteredDifferences = [];
        for (let i = 0; i < differenceResults.length; i++) {
            let missingId = differenceResults[i];
            let idData = _.find(video_sets, { id: missingId });
            if (typeof idData === "undefined") {
                logger.warn(
                    `youtubeLiveHeartbeat() while checking missing response, ID ${missingId} are missing from database`
                );
                continue;
            }
            idData["is_missing"] = true;
            idData["status"] = "past";
            idData["timedata"]["endTime"] = targetEndTime;
            if (idData["timedata"]["startTime"] && !idData["is_premiere"]) {
                idData["timedata"]["duration"] = targetEndTime - idData["timedata"]["startTime"];
            }
            if (idData["timedata"]["startTime"] && idData["timedata"]["scheduledStartTime"]) {
                idData["timedata"]["lateTime"] =
                    idData["timedata"]["startTime"] - idData["timedata"]["scheduledStartTime"];
            }
            let collectViewersData = await ViewersData.findOne({
                id: { $eq: idData["id"] },
                platform: { $eq: "youtube" },
            })
                .then((doc) => {
                    return doc;
                })
                .catch(() => {
                    return undefined;
                });
            if (typeof collectViewersData !== "undefined" && !_.isNull(collectViewersData)) {
                let viewersStats: any[] = _.get(collectViewersData, "viewersData", []);
                if (viewersStats.length > 0) {
                    let viewersNum = _.map(viewersStats, "viewers");
                    viewersNum = viewersNum.filter((v) => typeof v === "number");
                    let averageViewers = Math.round(_.sum(viewersNum) / viewersNum.length);
                    idData["averageViewers"] = isNaN(averageViewers) ? 0 : averageViewers;
                }
            }
            filteredDifferences.push(idData);
        }
        updateData = _.concat(updateData, filteredDifferences);
    }
    let dataWithAverageViewers = _.filter(updateData, (o) => _.has(o, "averageViewers"));
    if (dataWithAverageViewers.length > 0) {
        let viewersIdsToDelete = _.map(dataWithAverageViewers, "id");
        if (viewersIdsToDelete.length > 0) {
            logger.info(`youtubeLiveHeartbeat() removing ${viewersIdsToDelete.length} viewers data...`);
            try {
                await ViewersData.deleteMany({ id: { $in: viewersIdsToDelete } });
            } catch (e: any) {
                logger.error(`youtubeLiveHeartbeat() failed to remove viewers data, ${e.toString()}`);
            }
        }
    }

    if (updateData.length > 0) {
        logger.info(`youtubeLiveHeartbeat() committing update...`);
        const dbUpdate = updateData.map((new_update) =>
            // @ts-ignore
            VideosData.findOneAndUpdate({ id: { $eq: new_update.id } }, new_update, null, (err) => {
                if (err) {
                    logger.error(
                        `youtubeLiveHeartbeat() failed to update ${new_update.id}, ${err.toString()}`
                    );
                } else {
                    return;
                }
            })
        );
        await Promise.all(dbUpdate).catch((err) => {
            logger.error(`youtubeLiveHeartbeat() failed to update databases, ${err.toString()}`);
        });
    }

    logger.info("youtubeLiveHeartbeat() heartbeat updated!");
}

export async function youtubeChannelsStats(apiKeys: YTRotatingAPIKey, filtersRun: FiltersConfig) {
    let session = axios.create({
        headers: {
            "User-Agent": `vtschedule-ts/${vt_version} (https://github.com/ihateani-me/vtscheduler-ts)`,
        },
    });

    logger.info("youtubeChannelsStats() fetching channels data...");
    let channels_data = await ChannelsData.filteredFind(
        filtersRun["exclude"],
        filtersRun["include"],
        undefined,
        [{ platform: { $eq: "youtube" } }, { is_retired: { $eq: false } }]
    );
    if (channels_data.length < 1) {
        logger.warn(`youtubeChannelsStats() skipping because no registered channels`);
        return;
    }
    logger.info("youtubeChannelsStats() fetching history data...");
    let channels_history_data = await ChannelStatsHistData.filteredFind(
        filtersRun["exclude"],
        filtersRun["include"],
        {
            id: 1,
            platform: 1,
        },
        [{ platform: { $eq: "youtube" } }]
    );

    const chunked_channels_set = _.chunk(channels_data, 40);
    logger.info(
        `youtubeChannelsStats() checking channels with total of ${channels_data.length} channels (${chunked_channels_set.length} chunks)...`
    );
    const items_data_promises = chunked_channels_set.map((chunks, idx) =>
        session
            .get("https://www.googleapis.com/youtube/v3/channels", {
                params: {
                    part: "snippet,statistics",
                    id: _.join(_.map(chunks, "id"), ","),
                    maxResults: 50,
                    key: apiKeys.get(),
                },
                responseType: "json",
            })
            .then((result) => {
                let yt_result = result.data;
                return yt_result["items"];
            })
            .catch((err) => {
                logger.error(
                    `youtubeChannelsStats() failed to fetch info for chunk ${idx}, error: ${err.toString()}`
                );
                return [];
            })
    );

    let items_data: any[] = await Promise.all(items_data_promises).catch((err) => {
        logger.error(`youtubeChannelsStats() failed to fetch from API, error: ${err.toString()}`);
        return [];
    });
    if (items_data.length < 1) {
        logger.warn("youtubeChannelsStats() no response from API");
        return;
    }

    items_data = _.flattenDeep(items_data);
    let historySet: HistoryMap[] = [];
    logger.info(`youtubeChannelsStats() preparing update...`);
    let currentTimestamp = Math.floor(DateTime.utc().toSeconds());
    const to_be_committed = items_data.map((res_item) => {
        let ch_id = res_item["id"];
        let snippets: AnyDict = res_item["snippet"];
        let statistics: AnyDict = res_item["statistics"];

        let title = snippets["title"];
        let desc = snippets["description"];
        let customUrl = snippets["customUrl"] || null;

        let thumbs = getBestThumbnail(snippets["thumbnails"], "");
        let subsCount = 0,
            viewCount = 0,
            videoCount = 0;

        if (_.has(statistics, "subscriberCount")) {
            subsCount = fallbackNaN(parseInt, statistics["subscriberCount"], statistics["subscriberCount"]);
        }
        if (_.has(statistics, "viewCount")) {
            viewCount = fallbackNaN(parseInt, statistics["viewCount"], statistics["viewCount"]);
        }
        if (_.has(statistics, "videoCount")) {
            videoCount = fallbackNaN(parseInt, statistics["videoCount"], statistics["videoCount"]);
        }

        let chData = _.find(channels_data, { id: ch_id });
        let group: string;
        if (typeof chData !== "undefined") {
            group = chData["group"];
        } else {
            group = "unknown";
        }

        let oldHistory = _.find(channels_history_data, { id: ch_id });
        if (typeof oldHistory === "undefined") {
            historySet.push({
                id: ch_id,
                history: {
                    timestamp: currentTimestamp,
                    subscriberCount: subsCount,
                    viewCount: viewCount,
                    videoCount: videoCount,
                },
                mod: "insert",
                group: group,
            });
        } else {
            historySet.push({
                id: ch_id,
                history: {
                    timestamp: currentTimestamp,
                    subscriberCount: subsCount,
                    viewCount: viewCount,
                    videoCount: videoCount,
                },
                mod: "update",
                group: group,
            });
        }

        // @ts-ignore
        let finalData: ChannelsProps = {
            id: ch_id,
            name: title,
            yt_custom_id: customUrl,
            description: desc,
            thumbnail: thumbs,
            subscriberCount: subsCount,
            viewCount: viewCount,
            videoCount: videoCount,
        };
        return finalData;
    });

    if (to_be_committed.length > 0) {
        logger.info(`youtubeChannelsStats() committing update...`);
        const dbUpdate = to_be_committed.map((new_update) =>
            // @ts-ignore
            ChannelsData.findOneAndUpdate({ id: { $eq: new_update.id } }, new_update, null, (err) => {
                if (err) {
                    logger.error(
                        `youtubeChannelsStats() failed to update ${new_update.id}, ${err.toString()}`
                    );
                } else {
                    return;
                }
            })
        );
        await Promise.all(dbUpdate).catch((err) => {
            logger.error(`youtubeChannelsStats() failed to update databases, ${err.toString()}`);
        });
    }

    // Update history data
    logger.info("youtubeChannelsStats() updating/inserting channel stats!");
    let histDBUpdate = historySet
        .filter((o) => o.mod === "update")
        .map((new_upd) => {
            ChannelStatsHistData.update(
                { id: { $eq: new_upd.id }, platform: { $eq: "youtube" } },
                { $addToSet: { history: new_upd["history"] } },
                // @ts-ignore
                (err) => {
                    if (err) {
                        logger.error(
                            `youtubeChannelsStats() failed to update history ${new_upd.id}, ${err.toString()}`
                        );
                    } else {
                        return;
                    }
                }
            );
        });
    let insertDBUpdateList = historySet
        .filter((o) => o.mod === "insert")
        .map((peta) => {
            return {
                id: peta["id"],
                history: [peta["history"]],
                group: peta["group"],
                platform: "youtube",
            };
        });

    if (insertDBUpdateList.length > 0) {
        await ChannelStatsHistData.insertMany(insertDBUpdateList).catch((err) => {
            logger.error(
                `youtubeChannelsStats() failed to insert new history to databases, ${err.toString()}`
            );
        });
    }
    if (histDBUpdate.length > 0) {
        await Promise.all(histDBUpdate).catch((err) => {
            logger.error(`youtubeChannelsStats() failed to update history databases, ${err.toString()}`);
        });
    }

    logger.info("youtubeChannelsStats() channels stats updated!");
}

export async function youtubeVideoMissingCheck(apiKeys: YTRotatingAPIKey, filtersRun: FiltersConfig) {
    let session = axios.create({
        headers: {
            "User-Agent": `vtschedule-ts/${vt_version} (https://github.com/ihateani-me/vtscheduler-ts)`,
        },
    });

    logger.info("youtubeVideoMissingCheck() fetching missing videos data...");
    let video_sets = await VideosData.filteredFind(filtersRun["exclude"], filtersRun["include"], undefined, [
        {
            is_missing: { $eq: true },
        },
        {
            platform: { $eq: "youtube" },
        },
    ]);
    if (video_sets.length < 1) {
        logger.warn(`youtubeVideoMissingCheck() skipping because no missing video to check`);
        return;
    }

    const chunked_video_set = _.chunk(video_sets, 40);
    logger.info(
        `youtubeVideoMissingCheck() checking heartbeat on ${video_sets.length} videos (${chunked_video_set.length} chunks)...`
    );
    const items_data_promises = chunked_video_set.map((chunks, idx) =>
        session
            .get("https://www.googleapis.com/youtube/v3/videos", {
                params: {
                    part: "snippet,liveStreamingDetails,contentDetails,statistics",
                    id: _.join(_.map(chunks, "id"), ","),
                    maxResults: 50,
                    key: apiKeys.get(),
                },
                responseType: "json",
            })
            .then((result) => {
                let yt_result = result.data;
                return yt_result["items"];
            })
            .catch((err) => {
                logger.error(
                    `youtubeVideoMissingCheck() failed to fetch videos info for chunk ${idx}, error: ${err.toString()}`
                );
                return [];
            })
    );

    const wrappedPromises = resolveDelayCrawlerPromises(items_data_promises, 300);

    let items_data: any[] = await Promise.all(wrappedPromises).catch((err) => {
        logger.error(`youtubeVideoMissingCheck() failed to fetch from API, error: ${err.toString()}`);
        return [];
    });
    if (items_data.length < 1) {
        logger.warn("youtubeVideoMissingCheck() no response from API");
        return;
    }
    items_data = _.flattenDeep(items_data);
    logger.info(`youtubeVideoMissingCheck() preparing update...`);
    const pushMissingData: any[] = [];
    for (let i = 0; i < items_data.length; i++) {
        const res_item = items_data[i];
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
        const statistics: AnyDict = _.get(res_item, "statistics", {});

        let start_time = null;
        let ended_time = null;
        let scheduled_start_time = null;
        if (_.has(livedetails, "scheduledStartTime")) {
            scheduled_start_time = DateTime.fromISO(livedetails["scheduledStartTime"], {
                zone: "UTC",
            }).toSeconds();
        }
        if (_.has(livedetails, "actualStartTime")) {
            start_time = DateTime.fromISO(livedetails["actualStartTime"], { zone: "UTC" }).toSeconds();
            scheduled_start_time = DateTime.fromISO(livedetails["scheduledStartTime"], {
                zone: "UTC",
            }).toSeconds();
        }
        if (_.has(livedetails, "actualEndTime")) {
            ended_time = DateTime.fromISO(livedetails["actualEndTime"], { zone: "UTC" }).toSeconds();
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

        let oldData = _.find(video_sets, { id: video_id });
        let currentViewers = _.get(oldData, "viewers", null);
        let currentPeakViewers = _.get(oldData, "peakViewers", null);
        let viewersData = _.get(livedetails, "concurrentViewers", undefined);
        if (typeof viewersData !== "undefined") {
            viewersData = fallbackNaN(parseInt, viewersData, viewersData);
            currentViewers = viewersData;
        }
        if (!_.isNull(currentPeakViewers) && !_.isNull(currentViewers)) {
            if (currentViewers > currentPeakViewers) {
                currentPeakViewers = currentViewers;
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
            let currentViewersData = await ViewersData.findOne({ id: { $eq: video_id } })
                .then((doc) => {
                    return doc;
                })
                .catch((err) => {
                    return undefined;
                });
            if (typeof currentViewersData !== "undefined" && !_.isNull(currentViewersData)) {
                viewersDataArrays = _.get(currentViewersData, "viewersData", []);
                viewersDataArrays.push({
                    timestamp: Math.floor(DateTime.utc().toSeconds()),
                    viewers: currentViewers,
                });
                let viewUpdData = {
                    id: currentViewersData["id"],
                    viewersData: viewersDataArrays,
                };
                try {
                    await ViewersData.updateOne({ id: { $eq: currentViewersData["id"] } }, viewUpdData);
                } catch (e: any) {
                    logger.error(
                        `youtubeVideoMissingCheck() Failed to update viewers data for ID ${video_id}, ${e.toString()}`
                    );
                }
            } else {
                viewersDataArrays.push({
                    timestamp: Math.floor(DateTime.utc().toSeconds()),
                    viewers: currentViewers,
                });
                let viewNewData = {
                    id: video_id,
                    viewersData: viewersDataArrays,
                    group: _.get(oldData, "group", "unknown"),
                    platform: "youtube",
                };
                await ViewersData.insertMany([viewNewData]).catch((err) => {
                    logger.error(
                        `youtubeVideoMissingCheck() Failed to add viewers data for ID ${video_id}, ${err.toString()}`
                    );
                });
            }
        }

        let thumbs = getBestThumbnail(snippets["thumbnails"], video_id);

        let finalData: VideoProps = {
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
                duration: duration,
            },
            // @ts-ignore
            viewers: currentViewers,
            // @ts-ignore
            peakViewers: currentPeakViewers,
            thumbnail: thumbs,
            is_missing: false,
            is_premiere: is_premiere,
        };
        if (video_type === "live") {
            // check if it's a member stream by doing a very scuffed way to check :)
            let liveChatId: string | undefined = _.get(livedetails, "activeLiveChatId", undefined);
            if (typeof liveChatId !== "undefined") {
                // Viewers is hidden, status is live, viewCount are missing, and liveChat exist
                // It just means that the stream are most likely to be members-only mode.
                // This should save a lot of API call :)
                // And can be more consistent, if they since middleway through
                if (!_.has(livedetails, "concurrentViewers") && !_.has(statistics, "viewCount")) {
                    finalData["is_member"] = true;
                } else {
                    finalData["is_member"] = false;
                }
            }
        }
        if (video_type === "past") {
            let collectViewersData = await ViewersData.findOne({
                id: { $eq: video_id },
                platform: { $eq: "youtube" },
            })
                .then((doc) => {
                    return doc;
                })
                .catch(() => {
                    return undefined;
                });
            if (typeof collectViewersData !== "undefined" && !_.isNull(collectViewersData)) {
                let viewersStats: any[] = _.get(collectViewersData, "viewersData", []);
                if (viewersStats.length > 0) {
                    let viewersNum = _.map(viewersStats, "viewers");
                    viewersNum = viewersNum.filter((v) => typeof v === "number");
                    let averageViewers = Math.round(_.sum(viewersNum) / viewersNum.length);
                    finalData["averageViewers"] = isNaN(averageViewers) ? 0 : averageViewers;
                }
            }
        }
        pushMissingData.push(finalData);
    };

    if (pushMissingData.length > 0) {
        logger.info(`youtubeVideoMissingCheck() committing update...`);
        const dbUpdate = pushMissingData.map((new_update) =>
            // @ts-ignore
            VideosData.findOneAndUpdate({ id: { $eq: new_update.id } }, new_update, null, (err) => {
                if (err) {
                    logger.error(
                        `youtubeVideoMissingCheck() failed to update ${new_update.id}, ${err.toString()}`
                    );
                } else {
                    return;
                }
            })
        );
        await Promise.all(dbUpdate).catch((err) => {
            logger.error(`youtubeVideoMissingCheck() failed to update databases, ${err.toString()}`);
        });
    }
    logger.info("youtubeVideoMissingCheck() missing video checked!");
}
