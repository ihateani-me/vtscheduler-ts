import _ from "lodash";
import axios from "axios";
import moment from "moment-timezone";

import { VTuberModel } from "../dataset/model";

import {
    ChannelsData,
    ChannelsProps,
    ChannelStatsHistData,
    ChannelStatsHistProps
} from "../../src/models";
import { logger } from "../../src/utils/logger";
import { fallbackNaN, filterEmpty } from "../../src/utils/swissknife";
import { YTRotatingAPIKey } from "../../src/utils/ytkey_rotator";

import { version as vt_version } from "../../package.json";
interface AnyDict {
    [key: string]: any;
}

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

export async function youtubeChannelDataset(dataset: VTuberModel[], apiKeys: YTRotatingAPIKey) {
    let session = axios.create({
        headers: {
            "User-Agent": `vtschedule-ts/${vt_version} (https://github.com/ihateani-me/vtscheduler-ts)`
        }
    })

    let parsed_yt_channel: ChannelsProps[] = await ChannelsData.find({"group": {"$eq": dataset[0].id}, "platform": {"$eq": "youtube"}});
    let all_parsed_ids = _.map(parsed_yt_channel, "id");
    let group = dataset[0]["id"];

    let toBeParsed = dataset.map((data) => {
        // @ts-ignore
        if (all_parsed_ids.includes(data["youtube"])) {
            return null;
        }
        return {"id": data["youtube"], "group": data["id"], "name": data["name"]};
    });

    toBeParsed = filterEmpty(toBeParsed);
    if (toBeParsed.length < 1) {
        logger.warn(`youtubeChannelDataset(${group}) no new channels to be registered`);
        return;
    }

    const chunked_channels_set = _.chunk(toBeParsed, 40);
    logger.info(`youtubeChannelDataset(${group}) checking channels with total of ${toBeParsed.length} channels (${chunked_channels_set.length} chunks)...`);
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
                let channel_data = _.find(toBeParsed, {"id": res.id});
                // @ts-ignore
                res["enName"] = channel_data["name"];
                // @ts-ignore
                res["groupData"] = channel_data["group"];
                return res;
            })
            return items;
        }).catch((err) => {
            logger.error(`youtubeChannelDataset(${group}) failed to fetch info for chunk ${idx}, error: ${err.toString()}`);
            return [];
        })
    ))

    let items_data: any[] = await Promise.all(items_data_promises).catch((err) => {
        logger.error(`youtubeChannelDataset() failed to fetch from API, error: ${err.toString()}`)
        return [];
    });
    if (items_data.length < 1) {
        logger.warn("youtubeChannelDataset() no response from API");
        return;
    }

    items_data = _.flattenDeep(items_data);
    logger.info(`youtubeChannelDataset() preparing update...`);
    const to_be_committed = items_data.map((res_item) => {
        let ch_id = res_item["id"];
        let snippets: AnyDict = res_item["snippet"];
        let statistics: AnyDict = res_item["statistics"];

        let title = snippets["title"];
        let desc = snippets["description"];
        let pubAt = snippets["publishedAt"]
        let group = res_item["groupData"];
        let enName = res_item["enName"];

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

        // @ts-ignore
        let finalData: ChannelsProps = {
            id: ch_id,
            name: title,
            en_name: enName,
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
    });

    // @ts-ignore
    let historyDatas: ChannelStatsHistProps[] = to_be_committed.map((res) => {
        let timestamp = moment.tz("UTC").unix();
        return {
            id: res["id"],
            history: [
                {
                    timestamp: timestamp,
                    subscriberCount: res["subscriberCount"],
                    viewCount: res["viewCount"],
                    videoCount: res["videoCount"],
                }
            ],
            group: res["group"],
            platform: "youtube"
        }
    });

    if (to_be_committed.length > 1) {
        logger.info(`youtubeChannelDataset(${group}) committing new data...`);
        await ChannelsData.insertMany(to_be_committed).catch((err) => {
            logger.error(`youtubeChannelDataset(${group}) failed to insert new data, ${err.toString()}`);
        });
    }
    if (historyDatas.length > 1) {
        logger.info(`youtubeChannelDataset(${group}) committing new history data...`);
        await ChannelStatsHistData.insertMany(historyDatas).catch((err) => {
            logger.error(`youtubeChannelDataset(${group}) failed to insert new history data, ${err.toString()}`);
        })
    }
}
